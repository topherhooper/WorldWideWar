/** Bootstrap. */

import { must } from './dom.js';
import { start } from './app.js';

start(must<HTMLElement>('#root'));
