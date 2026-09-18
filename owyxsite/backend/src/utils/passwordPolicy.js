/** bcrypt only uses the first 72 bytes of a password. */
const BCRYPT_MAX_BYTES = 72;

function passwordTooLong(password) {
  return Buffer.byteLength(String(password ?? ''), 'utf8') > BCRYPT_MAX_BYTES;
}

module.exports = { BCRYPT_MAX_BYTES, passwordTooLong };
