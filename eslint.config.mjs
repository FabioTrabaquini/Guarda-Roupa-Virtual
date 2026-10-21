import js from "@eslint/js";
import globals from "globals";

export default [
    {
        ignores: ["node_modules/**", "data/**"],
    },
    {
        files: ["**/*.js"],
        ...js.configs.recommended,
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "commonjs",
            globals: { ...globals.node, ...globals.browser },
        },
        rules: {
            "no-unused-vars": ["warn", { args: "none" }],
        },
    },
];
