# decode-js

基于 Babel 的 AST 分析器和处理器，可以处理以下情况：

* stringArray（包括添加了旋转操作，以及嵌套调用的情况）
* 死代码
* 控制流扁平化（switch）
* 局部代码变换（Object表达式、字符串分割等）
* 自定义代码（自保护，禁止控制台调试，禁止控制台输出）

An AST analyzer and processor based on Babel that can handle the following situations:

* stringArray (including Rotate, Wrappers, and ChainedCalls)
* deadCode
* controlFlowFlattening (switch)
* transformer (ObjectExpression, SplitString, and etc.)
* customCode (self-defending, debug-protection, console-output)

## 使用 Usage

1. 准备一个nodejs环境

   Prepare a nodejs environment
   
2. 通过`npm i`安装依赖
   
   Install the dependencies via `npm i`
   
3. 按如下方式运行插件：

   Run the plugins as follows:

```shell
# pre-defined command
npm run xxx
# or full command
npm run decode -- -t type [-i input.js] [-o output.js]
```

`xxx`为预定义的指令，见[package.json](package.json)中的`scripts`字段。

`xxx` are predefined commands, see the `scripts` field in [package.json](package.json).

`type`：
* common (高频局部混淆)
* jjencode (sojson.com 版本)
* sojson
* sojsonv7
* obfuscator

默认输入文件为`input.js`，文件中不能包含除混淆代码以外的内容（例如非混淆代码）。

The default input file is `input.js`. The file cannot contain additional codes other than obfuscated code (such as non-obfuscated code).

默认输出文件为`output.js`。

The default output file is `output.js`. 

## Related Projects

* [cilame/v_jstools](https://github.com/cilame/v_jstools)
* [j4k0xb/webcrack](https://github.com/j4k0xb/webcrack)
* [NXY666/Jsjiemi](https://github.com/NXY666/Jsjiemi)


