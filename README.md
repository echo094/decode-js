# decode-js

使用AST方式（依赖Babel插件）实现的JS代码净化工具，包括常见的几种类型：

* 字面量还原（全局、代码块）
* 死代码清理、扁平化还原
* 条件、循环语句规范化
* 特殊函数清理

处理全局加密内容时使用VM2提供的环境。

## 使用

需要`node.js`环境，并安装依赖：`npm i`。

调用方法：

```shell
npm run -t xxx [-i input.js] [-o output.js]
```

`xxx`为预定义的插件，见[package.json](package.json)中的`scripts`字段。

默认输入文件为`input.js`，默认输出文件为`output.js`。

程序入口文件为：[src/main.js](src/main.js)，插件目录为[src/plugin](src/plugin)。

## 启发

参考了下面的项目：

* [cilame/v_jstools](https://github.com/cilame/v_jstools)
* [Cqxstevexw/decodeObfuscator](https://github.com/Cqxstevexw/decodeObfuscator)
* [NXY666/Jsjiemi](https://github.com/NXY666/Jsjiemi)


