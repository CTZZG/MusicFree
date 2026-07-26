module.exports = {
    root: true,
    extends: ['@react-native', 'prettier'],
    overrides: [
        {
            // Node ESM tooling (generator/*.mjs). The shared config's default
            // parser cannot handle `import.meta`, so these were reported as
            // parse errors and effectively went unlinted.
            files: ['*.mjs'],
            parser: 'espree',
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
            env: {
                node: true,
                es2022: true,
            },
            rules: {
                // These scripts parse binary audio containers (ASF/DSF/WAV
                // headers), where bitwise arithmetic is the correct tool.
                'no-bitwise': 'off',
            },
        },
        {
            files: ['*.ts', '*.tsx'],
            rules: {
                '@typescript-eslint/no-shadow': 'warn',
                'no-shadow': 'off',
                'no-undef': 'off',
                'react-hooks/exhaustive-deps': 'warn',
                "quotes": ["warn", "double"],
                "object-curly-spacing": ["error", "always"],
                "indent": ["error", 4],
                "semi": ["error", "always"],
                "comma-dangle": ["error", "always-multiline"], 
                "brace-style": ["error", "1tbs"], 
                "react/react-in-jsx-scope": "off"
            },
        },
    ],
};
