import { defineConfig, globalIgnores } from "eslint/config";
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from "globals";
import js from "@eslint/js";

export default defineConfig([
    globalIgnores([
        "input.js", 
        "output.js"
    ]),
	js.configs.recommended,
    eslintPluginPrettierRecommended,
    {
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: "module",
            globals: {
                ...globals.node,
        },
    },
}]);
