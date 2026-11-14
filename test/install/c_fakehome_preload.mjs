// Test author C: stands in for the real account's home so that "target inside the real home" can be tested with APPLY
// without touching the true home. The installer is told, through the password database call, that the account home
// is FAKE_REAL_HOME (a directory inside the jail). HOME stays the sandbox home. env FAKE_REAL_HOME_MODE=both also
// patches os.homedir().
import os from 'node:os';
import module from 'node:module';
const ui = os.userInfo;
os.userInfo = (...a) => ({ ...ui.apply(os, a), homedir: process.env.FAKE_REAL_HOME });
if (process.env.FAKE_REAL_HOME_MODE === 'both') os.homedir = () => process.env.FAKE_REAL_HOME;
try { module.syncBuiltinESMExports(); } catch { /* ignore */ }
