/**
 * Entry shim for the UI tests: registers the JSX loader before anything else
 * is imported. Used as `node --import ./tests/helpers/register-jsx.mjs <test>`.
 */

import { register } from 'node:module';

register('./jsx-hook.mjs', import.meta.url);
