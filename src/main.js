import fs from 'fs'
import PluginSojson from './plugin/sojson.js'
import PluginObfuscator from './plugin/obfuscator.js'

// 读取参数
let type = 'obfuscator'
if (process.argv.length > 2) {
  type = process.argv[2]
}
console.log(`类型: ${type}`)
let encodeFile = 'input.js'
if (process.argv.length > 3) {
  encodeFile = process.argv[3]
}
console.log(`输入: ${encodeFile}`)
let decodeFile = 'output.js'
if (process.argv.length > 4) {
  decodeFile = process.argv[4]
}
console.log(`输出: ${decodeFile}`)

// 读取源代码
const sourceCode = fs.readFileSync(encodeFile, { encoding: 'utf-8' })

// 净化源代码
let code
if (type === 'sojson') {
  code = PluginSojson(sourceCode)
} else if (type === 'obfuscator') {
  code = PluginObfuscator(sourceCode)
}

// 输出代码
fs.writeFile(decodeFile, code, () => {})
