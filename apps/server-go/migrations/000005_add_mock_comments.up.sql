-- ============================================================
-- AetherBlog V1.3.0 Mock Comments Data
-- ============================================================

INSERT INTO comments (post_id, nickname, email, content, status, is_admin, like_count, created_at, updated_at)
SELECT
    p.id,
    '张三',
    'zhangsan@example.com',
    '这篇文章写得太棒了！对虚拟线程的原理讲解非常清晰，学到了很多。期待更多这样的深度技术文章！',
    'PENDING',
    FALSE,
    12,
    CURRENT_TIMESTAMP - INTERVAL '1 day',
    CURRENT_TIMESTAMP - INTERVAL '1 day'
FROM posts p WHERE p.slug = 'hello-world';

INSERT INTO comments (post_id, nickname, email, content, status, is_admin, like_count, created_at, updated_at)
SELECT
    p.id,
    '李四',
    'lisi@example.com',
    '请问虚拟线程和协程有什么区别？能否详细说明一下？',
    'DELETED',
    FALSE,
    5,
    CURRENT_TIMESTAMP - INTERVAL '2 days',
    CURRENT_TIMESTAMP - INTERVAL '2 days'
FROM posts p WHERE p.slug = 'hello-world';

INSERT INTO comments (post_id, nickname, email, content, status, is_admin, like_count, created_at, updated_at)
SELECT
    p.id,
    '王五',
    'wangwu@example.com',
    '感谢分享，这正是我在找的资料！',
    'APPROVED',
    FALSE,
    8,
    CURRENT_TIMESTAMP - INTERVAL '3 days',
    CURRENT_TIMESTAMP - INTERVAL '3 days'
FROM posts p WHERE p.slug = 'hello-world';

INSERT INTO comments (post_id, nickname, email, content, status, is_admin, like_count, created_at, updated_at)
SELECT
    p.id,
    'spammer123',
    'spam@spam.com',
    '免费领取优惠券，点击链接...',
    'SPAM',
    FALSE,
    0,
    CURRENT_TIMESTAMP - INTERVAL '4 days',
    CURRENT_TIMESTAMP - INTERVAL '4 days'
FROM posts p WHERE p.slug = 'hello-world';
