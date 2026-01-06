package com.aetherblog.blog.service;

import com.aetherblog.blog.entity.User;
import com.aetherblog.blog.entity.User.UserRole;
import com.aetherblog.blog.entity.User.UserStatus;
import com.aetherblog.blog.repository.UserRepository;
import com.aetherblog.common.core.exception.BusinessException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Optional;

/**
 * 用户业务服务
 * 
 * @ref §4.3 - 用户服务实现
 */
@Slf4j
@Service
@RequiredArgsConstructor
@SuppressWarnings("null")
public class UserService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    /**
     * 用户注册
     */
    @Transactional
    public User register(String username, String email, String password, String nickname) {
        // 检查用户名是否已存在
        if (userRepository.existsByUsername(username)) {
            throw new BusinessException("用户名已存在");
        }
        // 检查邮箱是否已存在
        if (userRepository.existsByEmail(email)) {
            throw new BusinessException("邮箱已被注册");
        }

        User user = new User();
        user.setUsername(username);
        user.setEmail(email);
        user.setPasswordHash(passwordEncoder.encode(password));
        user.setNickname(nickname != null ? nickname : username);
        user.setRole(UserRole.USER);
        user.setStatus(UserStatus.ACTIVE);

        User savedUser = userRepository.save(user);
        log.info("用户注册成功: username={}, email={}", username, email);
        return savedUser;
    }

    /**
     * 根据用户名或邮箱查找用户（用于登录）
     */
    public Optional<User> findByUsernameOrEmail(String identifier) {
        return userRepository.findByUsernameOrEmail(identifier);
    }

    /**
     * 根据ID查找用户
     */
    public Optional<User> findById(Long id) {
        return userRepository.findById(id);
    }

    /**
     * 根据用户名查找用户
     */
    public Optional<User> findByUsername(String username) {
        return userRepository.findByUsername(username);
    }

    /**
     * 验证密码
     */
    public boolean validatePassword(User user, String rawPassword) {
        return passwordEncoder.matches(rawPassword, user.getPasswordHash());
    }

    /**
     * 更新用户登录信息
     */
    @Transactional
    public void updateLoginInfo(Long userId, String loginIp) {
        userRepository.updateLoginInfo(userId, LocalDateTime.now(), loginIp);
        log.debug("更新用户登录信息: userId={}, ip={}", userId, loginIp);
    }

    /**
     * 更新用户状态
     */
    @Transactional
    public void updateStatus(Long userId, UserStatus status) {
        userRepository.updateStatus(userId, status);
        log.info("更新用户状态: userId={}, status={}", userId, status);
    }

    /**
     * 检查用户是否可以登录
     */
    public void checkUserCanLogin(User user) {
        if (user.getStatus() == UserStatus.INACTIVE) {
            throw new BusinessException("用户未激活");
        }
        if (user.getStatus() == UserStatus.BANNED) {
            throw new BusinessException("用户已被封禁");
        }
    }

    /**
     * 修改用户密码
     */
    @Transactional
    public void changePassword(Long userId, String newPassword) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException("用户不存在"));
        
        // 加密新密码
        String encodedPassword = passwordEncoder.encode(newPassword);
        user.setPasswordHash(encodedPassword);
        
        // 清除首次登录修改密码标记
        user.setMustChangePassword(false);
        
        userRepository.save(user);
        log.info("用户密码修改成功: userId={}", userId);
    }
}
