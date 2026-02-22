package com.aetherblog.blog.service;

import com.aetherblog.blog.entity.VisitRecord;
import com.aetherblog.blog.repository.VisitRecordRepository;
import com.aetherblog.blog.repository.VisitDailyStatRepository;
import com.aetherblog.blog.repository.PostRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.dao.DataIntegrityViolationException;

import java.util.concurrent.ConcurrentLinkedQueue;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
public class VisitorServiceVerificationTest {

    @Mock
    private VisitRecordRepository visitRecordRepository;

    @Mock
    private VisitDailyStatRepository visitDailyStatRepository;

    @Mock
    private PostRepository postRepository;

    @InjectMocks
    private VisitorService visitorService;

    @Test
    void flushVisits_SaveAllFails_ShouldFallbackToIndividualSave() {
        // Arrange
        ConcurrentLinkedQueue<VisitRecord> visitBuffer = new ConcurrentLinkedQueue<>();
        VisitRecord validRecord = new VisitRecord();
        VisitRecord invalidRecord = new VisitRecord();

        validRecord.setIp("192.168.1.1");
        invalidRecord.setIp("10.0.0.1");

        visitBuffer.add(validRecord);
        visitBuffer.add(invalidRecord);

        ReflectionTestUtils.setField(visitorService, "visitBuffer", visitBuffer);

        // Simulate saveAll failure
        doThrow(new DataIntegrityViolationException("Data too long")).when(visitRecordRepository).saveAll(anyList());

        // Simulate individual save results
        when(visitRecordRepository.saveAndFlush(validRecord)).thenReturn(validRecord);
        doThrow(new DataIntegrityViolationException("Data too long")).when(visitRecordRepository)
                .saveAndFlush(invalidRecord);

        // Act
        visitorService.flushVisits();

        // Assert
        verify(visitRecordRepository, times(1)).saveAll(anyList());
        verify(visitRecordRepository, times(1)).saveAndFlush(validRecord);
        verify(visitRecordRepository, times(1)).saveAndFlush(invalidRecord);
    }
}
