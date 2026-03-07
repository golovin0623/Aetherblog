package com.aetherblog.blog.repository;

import com.aetherblog.blog.entity.FriendLink;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface FriendLinkRepository extends JpaRepository<FriendLink, Long> {

    List<FriendLink> findByVisibleTrueOrderBySortOrderAsc();

    Optional<FriendLink> findByUrl(String url);

    @Query("SELECT MAX(f.sortOrder) FROM FriendLink f")
    Long findMaxSortOrder();

    @Modifying
    @Query(value = """
            WITH _cfg AS (
                SELECT set_config('app.preserve_updated_at', 'true', true)
            )
            UPDATE friend_links
            SET created_at = :createdAt,
                updated_at = :updatedAt
            FROM _cfg
            WHERE id = :id
            """, nativeQuery = true)
    void applyImportMetadata(
            @Param("id") Long id,
            @Param("createdAt") LocalDateTime createdAt,
            @Param("updatedAt") LocalDateTime updatedAt
    );
}
