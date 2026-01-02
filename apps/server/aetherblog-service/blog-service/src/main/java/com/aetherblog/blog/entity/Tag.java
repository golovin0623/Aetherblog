package com.aetherblog.blog.entity;

import jakarta.persistence.*;
import lombok.Data;

/**
 * 标签实体
 */
@Data
@Entity
@Table(name = "tags")
public class Tag {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 50)
    private String name;

    @Column(nullable = false, unique = true, length = 50)
    private String slug;

    @Column(length = 20)
    private String color;
}
