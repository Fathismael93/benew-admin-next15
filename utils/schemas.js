import * as yup from 'yup';

export const addArticleSchema = yup.object().shape({
  title: yup
    .string()
    .required('Title is required')
    .min(10, 'Title must be longer than 10 characters'),
  text: yup
    .string()
    .required('Text is required')
    .min(500, 'Text must be longer than 500 characters'),
  imageUrl: yup.string().required('Image is missing for this article'),
});

export const articleIDSchema = yup.object().shape({
  id: yup.number().positive("This article id doesn't exist"),
});

// Custom validation functions
const hasNumber = (value) => /\d/.test(value);
const hasUpperCase = (value) => /[A-Z]/.test(value);
const hasLowerCase = (value) => /[a-z]/.test(value);
const hasSpecialChar = (value) => /[!@#$%^&*(),.?":{}|<>]/.test(value);
const noConsecutiveChars = (value) => !/(.)\1{2,}/.test(value);
const noCommonWords = (value) => {
  const commonWords = ['password', 'admin', 'user', '123456', 'qwerty'];
  return !commonWords.some((word) => value.toLowerCase().includes(word));
};

export const registrationSchema = yup.object().shape({
  username: yup
    .string()
    .required('Username is required')
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must not exceed 50 characters')
    .matches(
      /^[a-zA-Z0-9._-]+$/,
      'Username can only contain letters, numbers, and ._-',
    )
    .matches(/^[a-zA-Z]/, 'Username must start with a letter')
    .test(
      'no-consecutive',
      'Username cannot contain repeating characters (e.g., aaa)',
      noConsecutiveChars,
    )
    .test(
      'reserved-words',
      'This username is not allowed',
      (value) =>
        !['admin', 'root', 'system', 'moderator'].includes(
          value?.toLowerCase(),
        ),
    ),

  email: yup
    .string()
    .required('Email is required')
    .email('Invalid email format')
    .max(255, 'Email must not exceed 255 characters')
    .test('domain', 'Please use a valid email domain', (value) => {
      if (!value) return true;
      const domain = value.split('@')[1];
      // List of disposable email domains to block
      const blockedDomains = [
        'tempmail.com',
        'throwawaymail.com',
        'tempmail.net',
        'test.com',
      ];
      return !blockedDomains.includes(domain);
    })
    .transform((value) => value?.toLowerCase().trim()),

  password: yup
    .string()
    .required('Password is required')
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must not exceed 128 characters')
    .test('has-number', 'Password must contain at least one number', hasNumber)
    .test(
      'has-uppercase',
      'Password must contain at least one uppercase letter',
      hasUpperCase,
    )
    .test(
      'has-lowercase',
      'Password must contain at least one lowercase letter',
      hasLowerCase,
    )
    .test(
      'has-special-char',
      'Password must contain at least one special character',
      hasSpecialChar,
    )
    .test(
      'no-common-words',
      'Password contains common words that are not allowed',
      noCommonWords,
    )
    .test(
      'username-in-password',
      'Password cannot contain your username',
      (value, context) =>
        !value?.toLowerCase().includes(context.parent.username?.toLowerCase()),
    ),

  confirmPassword: yup
    .string()
    .required('Please confirm your password')
    .oneOf([yup.ref('password')], 'Passwords must match'),

  terms: yup
    .boolean()
    .oneOf([true], 'You must accept the terms and conditions'),

  dateOfBirth: yup
    .date()
    .max(new Date(), 'Date of birth cannot be in the future')
    .min(new Date(1900, 0, 1), 'Invalid date of birth')
    .test(
      'age',
      'You must be at least 13 years old',
      (value) => !value || new Date().getFullYear() - value.getFullYear() >= 13,
    ),
});
