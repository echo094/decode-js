"""Retain exact empirical inputs/results in bounded tar parts and verify every member."""
import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import io
import json
from pathlib import Path
import tarfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_identity(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(data)
    return {'bytes': path.stat().st_size, 'sha256': h.hexdigest()}


class PartsWriter:
    def __init__(self, directory, maximum):
        self.directory, self.maximum = directory, maximum
        self.stream, self.size, self.parts = None, 0, []

    def write(self, data):
        view = memoryview(data)
        while view:
            if self.stream is None:
                path = self.directory / f'evidence.tar.gz.part{len(self.parts)+1:03d}'
                self.stream = path.open('xb')
                self.parts.append({'path': path.name})
                self.size = 0
            amount = min(len(view), self.maximum-self.size)
            self.stream.write(view[:amount])
            self.size += amount
            view = view[amount:]
            if self.size == self.maximum:
                self.stream.close()
                self.stream = None
        return len(data)

    def flush(self):
        if self.stream:
            self.stream.flush()

    def close(self):
        if self.stream:
            self.stream.close()
            self.stream = None
        for part in self.parts:
            part.update(file_identity(self.directory / part['path']))


class PartsReader(io.RawIOBase):
    def __init__(self, paths):
        self.paths = iter(paths)
        self.stream = None

    def readable(self):
        return True

    def readinto(self, buffer):
        while True:
            if self.stream is None:
                path = next(self.paths, None)
                if path is None:
                    return 0
                self.stream = path.open('rb')
            data = self.stream.read(len(buffer))
            if data:
                buffer[:len(data)] = data
                return len(data)
            self.stream.close()
            self.stream = None

    def close(self):
        if self.stream:
            self.stream.close()
        super().close()


def verify(manifest_path):
    manifest = json.loads(manifest_path.read_text())
    paths = []
    for part in manifest['parts']:
        path = manifest_path.parent / part['path']
        if file_identity(path) != {k: part[k] for k in ['bytes', 'sha256']}:
            raise ValueError(f'Archive part identity changed: {part["path"]}')
        paths.append(path)
    expected = {member['path']: member for member in manifest['members']}
    if len(expected) != len(manifest['members']):
        raise ValueError('Duplicate manifest member')
    found = set()
    with io.BufferedReader(PartsReader(paths)) as stream, tarfile.open(fileobj=stream, mode='r|gz') as archive:
        for member in archive:
            if member.name in found or member.name not in expected:
                raise ValueError(f'Duplicate or unexpected archive member: {member.name}')
            found.add(member.name)
            record = expected[member.name]
            if member.issym():
                actual = {'path': member.name, 'kind': 'symlink', 'target': member.linkname, 'sha256': digest(member.linkname.encode())}
            elif member.isfile():
                h = hashlib.sha256()
                count = 0
                with archive.extractfile(member) as contents:
                    for data in iter(lambda: contents.read(1024*1024), b''):
                        h.update(data)
                        count += len(data)
                actual = {'path': member.name, 'bytes': count, 'sha256': h.hexdigest()}
            else:
                raise ValueError(f'Unexpected member type: {member.name}')
            if actual != record:
                raise ValueError(f'Archive member identity changed: {member.name}')
    if found != set(expected):
        raise ValueError('Missing archive members')
    return {'verifiedAt': datetime.now(timezone.utc).isoformat(), 'members': len(found),
            'manifestSha256': digest(manifest_path.read_bytes()), 'completeReadback': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify', type=Path)
    parser.add_argument('--root', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--input', action='append', type=Path, default=[])
    parser.add_argument('--part-mib', type=int, default=40)
    parser.add_argument('--boundary')
    args = parser.parse_args()
    if args.verify:
        print(json.dumps(verify(args.verify.resolve(strict=True))))
        return
    if not args.root or not args.output or not args.input or not args.boundary or not 1 <= args.part_mib <= 48:
        parser.error('Creation requires root, exclusive output, inputs, boundary and part size in 1..48 MiB')
    root = args.root.resolve(strict=True)
    output = args.output.resolve()
    files = {}
    for requested in args.input:
        path = root / requested
        if not path.exists() and not path.is_symlink():
            raise ValueError(f'Missing requested input: {requested}')
        selected = list(path.rglob('*')) if path.is_dir() else [path]
        for item in selected:
            if item.is_symlink() or item.is_file():
                relative = item.relative_to(root).as_posix()
                if output == item or output in item.parents:
                    raise ValueError('Archive output overlaps an input')
                files[relative] = item
    output.mkdir(parents=True, exist_ok=False)
    records = []
    writer = PartsWriter(output, args.part_mib*1024*1024)
    try:
        with gzip.GzipFile(fileobj=writer, mode='wb', mtime=0) as compressed, tarfile.open(fileobj=compressed, mode='w|', format=tarfile.PAX_FORMAT) as archive:
            for name, path in sorted(files.items()):
                if path.is_symlink():
                    target = path.readlink().as_posix()
                    record = {'path': name, 'kind': 'symlink', 'target': target, 'sha256': digest(target.encode())}
                else:
                    record = {'path': name, **file_identity(path)}
                archive.add(path, arcname=name, recursive=False)
                records.append(record)
    finally:
        writer.close()
    manifest = {'boundary': args.boundary, 'createdAt': datetime.now(timezone.utc).isoformat(),
                'format': 'ordered gzip PAX tar parts', 'parts': writer.parts, 'members': records,
                'externalPrerequisites': ['Identified Node/JDK binaries and external dependency symlink targets require separate supply.'],
                'looseOriginalsPreserved': True}
    manifest_path = output / 'archive-manifest.json'
    manifest_path.write_text(json.dumps(manifest, indent=2)+'\n')
    result = verify(manifest_path)
    (output / 'readback.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
