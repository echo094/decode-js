import { defineConfig, globalIgnores } from "eslint/config";
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import globals from "globals";
import js from "@eslint/js";
import importX from "eslint-plugin-import-x";
import dataNotFunctions from "./eslint-rules/data-not-functions.js";

export default defineConfig([
    globalIgnores([
        "input.js", 
        "output.js"
    ]),
	js.configs.recommended,
    // Formatting is Prettier's (`npm run format`): this only turns off the rules it would clash with.
    eslintConfigPrettier,
    {
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: "module",
            globals: {
                ...globals.node,
        },
    },
    },
    // Dependencies (CONTRIBUTING.md): one direction, at import and at run time.
    {
        files: ["src/**/*.js"],
        plugins: {
            "import-x": importX,
            local: { rules: { "data-not-functions": dataNotFunctions } },
        },
        rules: {
            "import-x/no-cycle": "error",
            "local/data-not-functions": "error",
        },
    },
    // The limits (CONTRIBUTING.md); a known exception is disabled at its function, with its reason.
    {
        files: [
            "src/vm/**/*.js",
            "src/plugin/jsconfuser-vm.js",
            "src/plugin/jsconfuser-vm-sequential.js",
        ],
        rules: {
            complexity: ["error", 20],
            "max-depth": ["error", 3],
            "max-params": ["error", 5],
            "max-lines-per-function": ["error", { max: 80, skipBlankLines: true, skipComments: true }],
            "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }],
        },
    },
]);
