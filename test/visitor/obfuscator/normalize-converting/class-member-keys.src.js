class Foo {
  constructor () { this.made = 'ctor'; }
  bar () { return 'bar'; }
  'quoted' () { return 'quoted'; }
  static make () { return new Foo(); }
}
process.stdout.write(Foo.make().made + ' ' + new Foo().bar() + ' ' + new Foo().quoted() + '\n');
