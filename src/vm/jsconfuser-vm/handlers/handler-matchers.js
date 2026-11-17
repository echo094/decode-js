// One reference per canonical opcode, written in the handler locator's lowered form and compared by
// effects (handler-meaning.js), so every spelling a runtime layer or an outer encoder gives the same
// operation fits it: `$operand()` and `$constant(...)` are the reader calls; `$name` is a role bound
// to one actual term, `this` or a property name; `$_ROLE` binds a number (a frame-header offset or
// the spread sentinel). Roles in DISPATCH_ROLES name one thing across the whole dispatch; the others
// are local to one handler. A helper is called as a method here; its devirtualized function form
// fits too. The one spelling effects cannot equate is a helper's body inlined into the handler
// (Closure minify's upvalue cell), so those two opcodes also keep the inlined form.

const read = '$operand()'
const reg = `$regs[$base+${read}]`
const dst = `$dst=${read};`
const put = (value) => `$regs[$base+$dst]=${value};`

const matchers = []
const add = (name, ...sources) =>
  sources.forEach((source) => matchers.push({ name, source }))

add('LOAD_CONST', dst + put('$constant()'))
add('LOAD_INT', dst + put(read))
add(
  'LOAD_GLOBAL',
  `${dst}$name=$constant();if(!($name in $vm.$globalsField))throw new ReferenceError(\`\${$name} is not defined\`);${put('$vm.$globalsField[$name]')}`,
)
// Minify can inline the upvalue cell's read and write into the handler.
const cell = `$cell=$regs[$fp+$_CLOSURE].$upvaluesField`
const cellSlot = '$cell.$cellRegsField[$cell.$cellSlotField]'
add(
  'LOAD_UPVALUE',
  dst + put(`$regs[$fp+$_CLOSURE].$upvaluesField[${read}].$readMethod()`),
  `${dst}${cell}[${read}];${put(`$cell.$closedField?$cell.$cellValueField:${cellSlot}`)}`,
)
add(
  'STORE_UPVALUE',
  `$index=${read};$regs[$fp+$_CLOSURE].$upvaluesField[$index].$writeMethod(${reg});`,
  `$index=${read};${cell}[$index];$value=${reg};$cell.$closedField?$cell.$cellValueField=$value:${cellSlot}=$value;`,
)
add('LOAD_THIS', dst + put('$regs[$fp+$_THIS]'))
add('MOVE', dst + put(reg))
add('STORE_GLOBAL', `$vm.$globalsField[$constant()]=${reg};`)
add('GET_PROP', `${dst}$object=${reg};$key=${reg};${put('$object[$key]')}`)
add(
  'SET_PROP',
  `$object=${reg};$key=${reg};$value=${reg};Reflect.set($object,$key,$value);`,
)
add(
  'DELETE_PROP',
  `${dst}$object=${reg};$key=${reg};${put('delete $object[$key]')}`,
)
for (const [name, operator] of [
  ['ADD', '+'],
  ['SUB', '-'],
  ['MUL', '*'],
  ['DIV', '/'],
  ['MOD', '%'],
  ['BAND', '&'],
  ['BOR', '|'],
  ['BXOR', '^'],
  ['SHL', '<<'],
  ['SHR', '>>'],
  ['USHR', '>>>'],
  ['LT', '<'],
  ['GT', '>'],
  ['LTE', '<='],
  ['GTE', '>='],
  ['EQ', '==='],
  ['NEQ', '!=='],
  ['LOOSE_EQ', '=='],
  ['LOOSE_NEQ', '!='],
  ['IN', 'in'],
  ['INSTANCEOF', 'instanceof'],
])
  add(name, `${dst}$left=${reg};${put(`$left ${operator} ${reg}`)}`)
add('EXP', `${dst}$left=${reg};${put(`Math.pow($left,${reg})`)}`)
for (const [name, operator] of [
  ['UNARY_NEG', '-'],
  ['UNARY_POS', '+'],
  ['UNARY_NOT', '!'],
  ['UNARY_BITNOT', '~'],
  ['TYPEOF', 'typeof '],
])
  add(name, dst + put(`${operator}${reg}`))
add('VOID', `${dst}${read};${put('undefined')}`)
add(
  'TYPEOF_SAFE',
  `${dst}$name=$constant();$value=Object.prototype.hasOwnProperty.call($vm.$globalsField,$name)?$vm.$globalsField[$name]:undefined;${put('typeof $value')}`,
)
add('JUMP', `$regs[$fp+$_PC]=${read};`)
add(
  'JUMP_IF_FALSE',
  `$condition=${read};$target=${read};if(!$regs[$base+$condition])$regs[$fp+$_PC]=$target;`,
)
add(
  'JUMP_IF_TRUE',
  `$condition=${read};$target=${read};if($regs[$base+$condition])$regs[$fp+$_PC]=$target;`,
)
for (const [name, receiver, thisValue, flag, host] of [
  ['CALL', '', '$vm.$globalsField', '', '$callee.apply(null,$args)'],
  [
    'CALL_METHOD',
    `$receiver=${reg};`,
    '$receiver',
    '',
    '$callee.apply($receiver,$args)',
  ],
  [
    'NEW',
    '',
    'Object.create($closure.prototype||null)',
    '|1',
    'Reflect.construct($callee,$args)',
  ],
])
  add(
    name,
    `${dst}${receiver}$callee=${reg};$argc=${read};if($argc===$_SPREAD)$args=${reg};else{$args=new Array($argc);for(var $i=0;$i<$argc;$i++)$args[$i]=${reg};}
    $closure=$callee&&$closureMap.get($callee);if($closure)$vm.$pushFrameMethod($closure,$args,${thisValue},$dst<<1${flag});else $regs[$base+$dst]=${host};`,
  )
add(
  'RETURN',
  `$value=${reg};$vm.$closeMethod($fp);$caller=$regs[$fp+$_CALLER];$retDst=$regs[$fp+$_RET_DST];
  if($retDst&1&&(typeof $value!=="object"||$value===null))$value=$regs[$fp+$_THIS];
  $end=$fp+$regs[$fp+$_FRAME_SIZE];for(var $i=$fp;$i<$end;$i++)$regs[$i]=undefined;
  $vm.$topField=$fp;$vm.$frameField=$caller;$regs[$caller?$regs[$caller+$_REG_BASE]+($retDst>>1):0]=$value;`,
)
add('THROW', `throw ${reg};`)
add(
  'MAKE_CLOSURE',
  `${dst}$startPc=${read};$paramCount=${read};$regCount=${read};$uvCount=${read};$hasRest=${read};
  $descs=new Array($uvCount);
  for($i=0;$i<$uvCount;$i++){$isLocal=${read};$uvIndex=${read};$descs[$i]={$localField:$isLocal,$indexField:$uvIndex};}
  $fn={$paramField:$paramCount,$countField:$regCount,$startField:$startPc,$restField:$hasRest};$closure=new $Closure($fn);
  for($i=0;$i<$descs.length;$i++){$desc=$descs[$i];if($desc.$localField)$closure.$upvaluesField.push($vm.$captureMethod($fp,$desc.$indexField));else $closure.$upvaluesField.push($regs[$fp+$_CLOSURE].$upvaluesField[$desc.$indexField]);}
  $self=$vm;$shell=function($inner){return function(){return new $VM($self.$wordsField,$self.$poolField,$self.$globalsField).$runMethod($inner,this==null?$self.$globalsField:this,Array.prototype.slice.call(arguments));};}($closure);
  $closureMap.set($shell,$closure);$shell.prototype=$closure.prototype;${put('$shell')}`,
)
add(
  'BUILD_ARRAY',
  `${dst}$count=${read};$array=new Array($count);for(var $i=0;$i<$count;$i++)$array[$i]=${reg};${put('$array')}`,
)
add(
  'BUILD_OBJECT',
  `${dst}$count=${read};$object={};for(var $i=0;$i<$count;$i++){$key=${reg};$value=${reg};$object[$key]=$value;}${put('$object')}`,
)
for (const [name, kind, other] of [
  ['DEFINE_GETTER', 'get', 'set'],
  ['DEFINE_SETTER', 'set', 'get'],
])
  add(
    name,
    `$object=${reg};$key=${reg};$accessor=${reg};$existing=Object.getOwnPropertyDescriptor($object,$key);$descriptor={${kind}:$accessor,configurable:true,enumerable:true};if($existing&&typeof $existing.${other}==="function")$descriptor.${other}=$existing.${other};Object.defineProperty($object,$key,$descriptor);`,
  )
add(
  'FOR_IN_SETUP',
  `${dst}$object=${reg};$keys=[];if($object!==null&&$object!==undefined){$seen=Object.create(null);$current=Object($object);while($current!==null){$own=Object.getOwnPropertyNames($current);for(var $i=0;$i<$own.length;$i++){$key=$own[$i];if(!($key in $seen)){$seen[$key]=true;$property=Object.getOwnPropertyDescriptor($current,$key);if($property&&$property.enumerable)$keys.push($key);}}$current=Object.getPrototypeOf($current);}}${put('{$keysField:$keys,$iteratorIndexField:0}')}`,
)
add(
  'FOR_IN_NEXT',
  `${dst}$iterator=${reg};$target=${read};if($iterator.$iteratorIndexField>=$iterator.$keysField.length)$regs[$fp+$_PC]=$target;else $regs[$base+$dst]=$iterator.$keysField[$iterator.$iteratorIndexField++];`,
)
const handlerStack =
  '$handlers=$regs[$fp+$_HANDLERS];if(!$handlers)$regs[$fp+$_HANDLERS]=$handlers=[];'
add(
  'TRY_SETUP',
  `${handlerStack}$handlers.push({$handlerPcField:${read},$exceptionRegField:${read}});`,
)
add(
  'FINALLY_SETUP',
  `${handlerStack}$handlers.push({$finallyPcField:${read},$contRegField:${read},$payloadRegField:${read},$throwPadField:${read}});`,
)
add('TRY_END', '$regs[$fp+$_HANDLERS].pop();')
add(
  'PATCH',
  `$destPc=${read};$sliceStart=${read};$sliceEnd=${read};$key=${read}^$destPc|0;for(var $i=$sliceStart;$i<$sliceEnd;$i++){$key=$key+2654435769|0;$vm.$wordsField[$destPc+($i-$sliceStart)]=($vm.$wordsField[$i]^($key^$key>>>13))>>>0;}`,
)
add('DEBUGGER', 'debugger;')
add('JUMP_REG', `$regs[$fp+$_PC]=${reg};`)

// Bound once for the whole dispatch: the interpreter's own state, helpers and fields.
const DISPATCH_NAMES = new Set([
  'vm',
  'regs',
  'base',
  'fp',
  'closureMap',
  'readUpvalue',
  'writeUpvalue',
  'pushFrame',
  'closeFrame',
  'capture',
  'Closure',
  'VM',
  'run',
])
export function isDispatchRole(name) {
  return (
    name.startsWith('_') ||
    DISPATCH_NAMES.has(name) ||
    name.endsWith('Field') ||
    name.endsWith('Method')
  )
}

export const HANDLER_MATCHERS = matchers
