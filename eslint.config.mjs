// Extend Harper's ESLint configuration
import harperESLint from '@harperdb/code-guidelines/eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig([
	...harperESLint,
	{
		rules: {
			'no-unused-vars': [
				'warn',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
				},
			],
		},
	},
]);
