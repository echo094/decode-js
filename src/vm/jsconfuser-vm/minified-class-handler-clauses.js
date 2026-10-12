import { semanticClause } from './minified-class-semantic-clauses.js'

const read = '$operand($vm)'
const reg = `$regs[$base+${read}]`
const dst = `$dst=${read};`
const put = (value) => `$regs[$base+$dst]=${value};break;`
const bodies = new Map()
const set = (opcode, source) => bodies.set(opcode, semanticClause(source))
set(0, dst + put('$constant($vm)'))
set(1, dst + put(read))
set(
  2,
  `${dst}$name=$constant($vm);if(!($name in $vm.$globalsField))throw new ReferenceError(\`\${$name} is not defined\`);${put('$vm.$globalsField[$name]')}`,
)
set(3, dst + put(`$readUpvalue($regs[$fp+4].$upvaluesField[${read}])`))
set(4, dst + put('$regs[$fp+3]'))
set(5, dst + put(reg))
set(6, `$vm.$globalsField[$constant($vm)]=${reg};break;`)
set(
  7,
  `$index=${read};$writeUpvalue($regs[$fp+4].$upvaluesField[$index],${reg});break;`,
)
set(8, `${dst}$object=${reg};$key=${reg};${put('$object[$key]')}`)
set(
  9,
  `$object=${reg};$key=${reg};$value=${reg};Reflect.set($object,$key,$value);break;`,
)
set(10, `${dst}$object=${reg};$key=${reg};${put('delete $object[$key]')}`)
const binary = {
  11: '+',
  12: '-',
  13: '*',
  14: '/',
  15: '%',
  16: '&',
  17: '|',
  18: '^',
  19: '<<',
  20: '>>',
  21: '>>>',
  22: '<',
  23: '>',
  24: '<=',
  25: '>=',
  26: '===',
  27: '!==',
  28: '==',
  29: '!=',
  30: 'in',
  31: 'instanceof',
}
for (const [opcode, operator] of Object.entries(binary))
  set(Number(opcode), `${dst}$left=${reg};${put(`$left ${operator} ${reg}`)}`)
set(60, `${dst}$left=${reg};${put(`Math.pow($left,${reg})`)}`)
for (const [opcode, operator] of [
  [32, '-'],
  [33, '+'],
  [34, '!'],
  [35, '~'],
  [36, 'typeof'],
])
  set(opcode, dst + put(`${operator} ${reg}`))
set(37, `${dst}${read};${put('void 0')}`)
set(
  38,
  `${dst}$name=$constant($vm);$value=Object.prototype.hasOwnProperty.call($vm.$globalsField,$name)?$vm.$globalsField[$name]:void 0;${put('typeof $value')}`,
)
set(39, `$regs[$fp+0]=${read};break;`)
set(
  40,
  `$condition=${read};$target=${read};$regs[$base+$condition]||($regs[$fp+0]=$target);break;`,
)
set(
  41,
  `$condition=${read};$target=${read};$regs[$base+$condition]&&($regs[$fp+0]=$target);break;`,
)
for (const opcode of [42, 43, 44]) {
  const thisRead = opcode === 43 ? `$thisVal=${reg};` : ''
  const thisValue =
    opcode === 42
      ? '$vm.$globalsField'
      : opcode === 43
        ? '$thisVal'
        : 'Object.create($closure.prototype||null)'
  const host =
    opcode === 44
      ? 'Reflect.construct($callee,$args)'
      : `$callee.apply(${opcode === 43 ? '$thisVal' : 'null'},$args)`
  set(
    opcode,
    `${dst}${thisRead}$callee=${reg};$argc=${read};
    if($argc===65535)$args=${reg};else for($args=Array($argc),$counter=0;$counter<$argc;$counter++)$args[$counter]=${reg};
    ($closure=$callee&&$closureMap.get($callee))?$pushFrame($vm,$closure,$args,${thisValue},${opcode === 44 ? '$dst<<1|1' : '$dst<<1'}):$regs[$base+$dst]=${host};break;`,
  )
}
set(
  45,
  `$value=${reg};$closeFrame($vm,$fp);$caller=$regs[$fp+1];$retDst=$regs[$fp+2];
  $retDst&1&&(typeof $value!=="object"||$value===null)&&($value=$regs[$fp+3]);
  $end=$fp+$regs[$fp+6];for($counter=$fp;$counter<$end;$counter++)$regs[$counter]=void 0;
  $vm.$topField=$fp;$vm.$frameField=$caller;$regs[$caller?$regs[$caller+7]+($retDst>>1):0]=$value;break;`,
)
set(46, `throw ${reg};`)
set(
  47,
  `${dst}$startPc=${read};$paramCount=${read};$regCount=${read};$uvCount=${read};$hasRest=${read};$descs=Array($uvCount);
  for($counter=0;$counter<$uvCount;$counter++){$isLocal=${read};$uvIndex=${read};$descs[$counter]={$localField:$isLocal,$indexField:$uvIndex};}
  $closure=$Closure({$paramField:$paramCount,$countField:$regCount,$startField:$startPc,$restField:$hasRest});
  for($counter=0;$counter<$descs.length;$counter++){$desc=$descs[$counter];$desc.$localField?$closure.$upvaluesField.push($capture($vm,$fp,$desc.$indexField)):$closure.$upvaluesField.push($regs[$fp+4].$upvaluesField[$desc.$indexField]);}
  $self=$vm;$shell=function($shellClosure){return function(){return $run($VM($self.$wordsField,$self.$poolField,$self.$globalsField),$shellClosure,this==null?$self.$globalsField:this,Array.prototype.slice.call(arguments));}}($closure);
  $closureMap.set($shell,$closure);$shell.prototype=$closure.prototype;${put('$shell')}`,
)
set(
  48,
  `${dst}$count=${read};$array=Array($count);for($counter=0;$counter<$count;$counter++)$array[$counter]=${reg};${put('$array')}`,
)
set(
  49,
  `${dst}$count=${read};$object={};for($counter=0;$counter<$count;$counter++){$key=${reg};$value=${reg};$object[$key]=$value;}${put('$object')}`,
)
for (const [opcode, kind, other] of [
  [50, 'get', 'set'],
  [51, 'set', 'get'],
])
  set(
    opcode,
    `$object=${reg};$key=${reg};$accessor=${reg};$existing=Object.getOwnPropertyDescriptor($object,$key);$descriptor={${kind}:$accessor,configurable:!0,enumerable:!0};$existing&&typeof $existing.${other}==="function"&&($descriptor.${other}=$existing.${other});Object.defineProperty($object,$key,$descriptor);break;`,
  )
set(
  52,
  `${dst}$object=${reg};$keys=[];if($object!==null&&$object!==void 0)for(var $seen=Object.create(null),$current=Object($object);$current!==null;){$own=Object.getOwnPropertyNames($current);for($counter=0;$counter<$own.length;$counter++){$key=$own[$counter];if(!($key in $seen)){$seen[$key]=!0;$descriptor=Object.getOwnPropertyDescriptor($current,$key);$descriptor&&$descriptor.enumerable&&$keys.push($key);}}$current=Object.getPrototypeOf($current);}${put('{$keysField:$keys,$iteratorIndexField:0}')}`,
)
set(
  53,
  `${dst}$iterator=${reg};$target=${read};$iterator.$iteratorIndexField>=$iterator.$keysField.length?$regs[$fp+0]=$target:$regs[$base+$dst]=$iterator.$keysField[$iterator.$iteratorIndexField++];break;`,
)
set(
  54,
  `$handlers=$regs[$fp+5];$handlers||($regs[$fp+5]=$handlers=[]);$handlers.push({$handlerPcField:${read},$exceptionRegField:${read}});break;`,
)
set(55, '$regs[$fp+5].pop();break;')
set(
  59,
  `$handlers=$regs[$fp+5];$handlers||($regs[$fp+5]=$handlers=[]);$handlers.push({$finallyPcField:${read},$contRegField:${read},$payloadRegField:${read},$throwPadField:${read}});break;`,
)
set(
  56,
  `$destPc=${read};$sliceStart=${read};$sliceEnd=${read};$key=${read}^$destPc|0;for($counter=$sliceStart;$counter<$sliceEnd;$counter++){$key=$key+2654435769|0;$vm.$wordsField[$destPc+($counter-$sliceStart)]=($vm.$wordsField[$counter]^$key^$key>>>13)>>>0;}break;`,
)
set(58, `$regs[$fp+0]=${reg};break;`)
set(57, 'debugger;break;')
export const HANDLER_CLAUSES = bodies
export const DEFAULT_CLAUSE = semanticClause(
  'throw Error("Unknown opcode: "+$opcode+" at pc "+($regs[$fp+0]-1));',
)
