/** bcrypt only uses the first 72 bytes of a password. */
const BCRYPT_MAX_BYTES = 72;

function passwordTooLong(password) {
  return Buffer.byteLength(String(password ?? ''), 'utf8') > BCRYPT_MAX_BYTES;
}

/**
 * Same complexity as registration: min 8, upper, digit, special.
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
  if (!/[A-ZА-ЯЁ]/.test(p)) {
    return 'Пароль должен содержать хотя бы одну заглавную букву';
  }
  if (!/\d/.test(p)) {
    return 'Пароль должен содержать хотя бы одну цифру';
  }
  if (!/[^A-Za-zА-Яа-яЁё0-9]/.test(p)) {
    return 'Пароль должен содержать хотя бы один спецсимвол';
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
      .withMessage('Пароль должен быть минимум 8 символов')
      .matches(/[A-ZА-ЯЁ]/)
      .withMessage('Пароль должен содержать хотя бы одну заглавную букву')
      .matches(/\d/)
      .withMessage('Пароль должен содержать хотя бы одну цифру')
      .matches(/[^A-Za-zА-Яа-яЁё0-9]/)
      .withMessage('Пароль должен содержать хотя бы один спецсимвол'),
  ];
}

module.exports = {
  BCRYPT_MAX_BYTES,
  passwordTooLong,
  passwordComplexityError,
  passwordComplexityValidators,
};
