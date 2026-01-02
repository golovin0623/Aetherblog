/**
 * 密码强度校验
 */

export type PasswordStrength = 'weak' | 'medium' | 'strong' | 'very-strong';

interface PasswordValidation {
  valid: boolean;
  strength: PasswordStrength;
  score: number;
  suggestions: string[];
}

export function validatePassword(password: string, minLength = 8): PasswordValidation {
  const suggestions: string[] = [];
  let score = 0;

  // 长度检查
  if (password.length >= minLength) score += 1;
  else suggestions.push(`密码长度至少${minLength}位`);

  if (password.length >= 12) score += 1;

  // 包含小写字母
  if (/[a-z]/.test(password)) score += 1;
  else suggestions.push('包含小写字母');

  // 包含大写字母
  if (/[A-Z]/.test(password)) score += 1;
  else suggestions.push('包含大写字母');

  // 包含数字
  if (/\d/.test(password)) score += 1;
  else suggestions.push('包含数字');

  // 包含特殊字符
  if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score += 1;
  else suggestions.push('包含特殊字符');

  // 确定强度
  let strength: PasswordStrength;
  if (score <= 2) strength = 'weak';
  else if (score <= 4) strength = 'medium';
  else if (score <= 5) strength = 'strong';
  else strength = 'very-strong';

  return {
    valid: score >= 4 && password.length >= minLength,
    strength,
    score,
    suggestions,
  };
}

export function getPasswordStrengthColor(strength: PasswordStrength): string {
  const colors: Record<PasswordStrength, string> = {
    weak: '#ef4444',
    medium: '#f59e0b',
    strong: '#22c55e',
    'very-strong': '#059669',
  };
  return colors[strength];
}
