import 'dotenv/config';
import { stdin as input, stdout as output } from 'node:process';
import bcrypt from 'bcryptjs';

function readHiddenPassword(): Promise<string> {
  if (!input.isTTY || !input.setRawMode) throw new Error('Run this command in a terminal so the password can be hidden.');
  return new Promise((resolve, reject) => {
    let password = '';
    output.write('Password to hash (hidden): ');
    input.setRawMode(true);
    input.resume();
    const onData = (key: Buffer) => {
      if (key[0] === 3) { input.off('data', onData); input.setRawMode(false); reject(new Error('Cancelled.')); return; }
      if (key[0] === 13 || key[0] === 10) {
        input.off('data', onData); input.setRawMode(false); input.pause(); output.write('\n'); resolve(password); return;
      }
      if (key[0] === 8 || key[0] === 127) password = password.slice(0, -1);
      else if (key[0] >= 32) password += key.toString('utf8');
    };
    input.on('data', onData);
  });
}

try {
  const password = await readHiddenPassword();
  if (password.length < 12) throw new Error('Use a password with at least 12 characters.');
  console.log('\nBcrypt hash (paste this into admins.password_hash):\n');
  console.log(await bcrypt.hash(password, 12));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Could not generate password hash.');
  process.exitCode = 1;
}
