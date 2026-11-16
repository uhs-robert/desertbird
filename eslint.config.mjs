import tseslint from "typescript-eslint";

// test/ is out of scope: node:test calls return promises, which would flag every test without a bug behind it.
export default tseslint.config(
    { ignores: ["dist/", "node_modules/", "vendor/"] },
    {
        files: ["src/**/*.ts", "tools/**/*.ts"],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
        },
        plugins: { "@typescript-eslint": tseslint.plugin },
        rules: {
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/no-misused-promises": "error",
        },
    },
);
