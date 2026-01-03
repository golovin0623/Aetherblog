package com.aetherblog.blog.service;

import com.aetherblog.blog.entity.User;
import com.aetherblog.blog.repository.UserRepository;
import com.aetherblog.common.security.domain.LoginUser;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

import java.util.Set;

/**
 * 用户详情服务实现
 * 
 * 实现 Spring Security 的 UserDetailsService 接口，
 * 从数据库加载用户信息用于认证。
 * 
 * @ref §4.4 - 安全架构实现
 */
@Service
@RequiredArgsConstructor
public class UserDetailsServiceImpl implements UserDetailsService {

    private final UserRepository userRepository;

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        User user = userRepository.findByUsernameOrEmail(username)
                .orElseThrow(() -> new UsernameNotFoundException("用户不存在: " + username));

        // 检查用户状态
        if (user.getStatus() != User.UserStatus.ACTIVE) {
            throw new UsernameNotFoundException("用户状态异常: " + user.getStatus());
        }

        return buildLoginUser(user);
    }

    /**
     * 将 User 实体转换为 LoginUser
     */
    private LoginUser buildLoginUser(User user) {
        LoginUser loginUser = new LoginUser();
        loginUser.setUserId(user.getId());
        loginUser.setUsername(user.getUsername());
        loginUser.setPassword(user.getPasswordHash());
        loginUser.setNickname(user.getNickname());
        loginUser.setAvatar(user.getAvatar());
        loginUser.setRoles(Set.of(user.getRole().name()));
        loginUser.setPermissions(Set.of()); // 暂不实现细粒度权限
        loginUser.setEnabled(user.getStatus() == User.UserStatus.ACTIVE);
        return loginUser;
    }
}
