module.exports = [
  {
    ignores: [
      'node_modules/**',
      'testing_data/**',
      '.agents/**',
      '.claude/**',
      '.impeccable/**',
    ],
  },
  {
    files: ['api/**/*.js', 'public/js/**/*.js', 'scripts/**/*.js', 'src/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
    },
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
    rules: {
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
    },
  },
];
