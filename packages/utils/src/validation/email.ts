/**
 * 邮箱校验
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

export function validateEmail(email: string): { valid: boolean; message: string } {
  if (!email) {
    return { valid: false, message: '邮箱不能为空' };
  }
  if (!EMAIL_REGEX.test(email)) {
    return { valid: false, message: '邮箱格式不正确' };
  }
  return { valid: true, message: '' };
}
