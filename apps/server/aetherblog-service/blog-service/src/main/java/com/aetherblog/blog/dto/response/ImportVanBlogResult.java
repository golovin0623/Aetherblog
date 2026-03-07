package com.aetherblog.blog.dto.response;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class ImportVanBlogResult {

    private Summary summary = new Summary();
    private List<String> warnings = new ArrayList<>();
    private List<String> errors = new ArrayList<>();
    private List<ItemResult> items = new ArrayList<>();

    @Data
    public static class Summary {
        private int importableArticles;
        private int importableDrafts;
        private int importableFriendLinks;
        private int createdCategories;
        private int reusedCategories;
        private int createdTags;
        private int reusedTags;
        private int createdPosts;
        private int updatedPosts;
        private int createdFriendLinks;
        private int updatedFriendLinks;
        private int skippedRecords;
        private int slugConflicts;
        private int invalidRecords;
    }

    @Data
    public static class ItemResult {
        private String sourceKey;
        private String type;
        private Long postId;
        private Long recordId;
        private String action;
        private List<String> warnings = new ArrayList<>();
    }
}
