/** bcrypt only uses the first 72 bytes of a password. */
const BCRYPT_MAX_BYTES = 72;

function passwordTooLong(password) {
  return Buffer.byteLength(String(password ?? ''), 'utf8') > BCRYPT_MAX_BYTES;
}

/**
 * Registration / reset policy: min 8 characters, max 72 bytes (bcrypt).
 * No required uppercase / digit / special — weak passwords are the user's choice.
 * Returns a Russian error string or null if OK.
 */
function passwordComplexityError(password) {
  const p = String(password ?? '');
  if (p.length < 8) {
    return 'Пароль должен быть минимум 8 символов';
  }
  if (passwordTooLong(p)) {
    return `Пароль не должен превышать ${BCRYPT_MAX_BYTES} байт`;
  }
  return null;
}

/** express-validator chain for register / reset (field name `password`). */
function passwordComplexityValidators(body) {
  return [
    body('password').custom((value) => {
      if (passwordTooLong(value)) {
        throw new Error(`Пароль не должен превышать ${BCRYPT_MAX_BYTES} байт`);
      }
      return true;
    }),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Пароль должен быть минимум 8 символов'),
  ];
}

module.exports = {
  BCRYPT_MAX_BYTES,
  passwordTooLong,
  passwordComplexityError,
  passwordComplexityValidators,
};
