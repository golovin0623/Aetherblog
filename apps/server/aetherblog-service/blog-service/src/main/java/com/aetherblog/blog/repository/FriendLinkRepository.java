package com.aetherblog.blog.repository;

import com.aetherblog.blog.entity.FriendLink;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface FriendLinkRepository extends JpaRepository<FriendLink, Long> {

    List<FriendLink> findByVisibleTrueOrderBySortOrderAsc();
}
