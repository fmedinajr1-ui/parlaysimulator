import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { compressImage } from '@/lib/image-compression';
import { toast } from '@/hooks/use-toast';

export type ExtractionStatus = 'queued' | 'processing' | 'retrying' | 'completed' | 'failed' | 'cancelled';

export interface QueuedExtraction {
  id: string;
  type: 'image' | 'video';
  file: File;
  preview: string;
  status: ExtractionStatus;
  position?: number;
  retryCount: number;
  maxRetries: number;
  error?: string;
  result?: {
    legs: Array<{ description: string; odds: string }>;
    totalOdds?: string;
    stake?: number;
    earliestGameTime?: string;
  };
  retryAfter?: number;
}

interface UseExtractionQueueOptions {
  maxConcurrent?: number;
  maxRetries?: number;
  baseRetryDelay?: number;
  onExtractionComplete?: (extraction: QueuedExtraction) => void;
  onAllComplete?: (extractions: QueuedExtraction[]) => void;
}

interface RateLimitInfo {
  isRateLimited: boolean;
  retryAfter: number;
  queuePosition?: number;
  message?: string;
}

export function useExtractionQueue(options: UseExtractionQueueOptions = {}) {
  const {
    maxConcurrent = 3,
    maxRetries = 3,
    baseRetryDelay = 2000,
    onExtractionComplete,
    onAllComplete,
  } = options;

  const [queue, setQueue] = useState<QueuedExtraction[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [rateLimitInfo, setRateLimitInfo] = useState<RateLimitInfo | null>(null);
  const [activeCount, setActiveCount] = useState(0);
  const processingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Calculate queue position for an item
  const getQueuePosition = useCallback((itemId: string): number => {
    const queuedItems = queue.filter(q => q.status === 'queued' || q.status === 'retrying');
    const index = queuedItems.findIndex(q => q.id === itemId);
    return index >= 0 ? index + 1 : 0;
  }, [queue]);

  // Estimate wait time based on position and average processing time
  const getEstimatedWaitTime = useCallback((position: number): number => {
    const avgProcessingTime = 5; // seconds per extraction
    return Math.ceil((position / maxConcurrent) * avgProcessingTime);
  }, [maxConcurrent]);

  // Add files to the queue
  const addToQueue = useCallback((files: File[], type: 'image' | 'video' = 'image'): QueuedExtraction[] => {
    const newItems: QueuedExtraction[] = files.map((file, idx) => ({
      id: crypto.randomUUID(),
      type,
      file,
      preview: URL.createObjectURL(file),
      status: 'queued' as ExtractionStatus,
      position: queue.length + idx + 1,
      retryCount: 0,
      maxRetries,
    }));

    setQueue(prev => [...prev, ...newItems]);
    return newItems;
  }, [queue.length, maxRetries]);

  // Process a single extraction with retry logic
  const processExtraction = useCallback(async (extraction: QueuedExtraction): Promise<QueuedExtraction> => {
    // Update status to processing
    setQueue(prev => prev.map(q => 
      q.id === extraction.id ? { ...q, status: 'processing' as ExtractionStatus } : q
    ));

    try {
      const { base64 } = await compressImage(extraction.file);
      
      const { data, error } = await supabase.functions.invoke('extract-parlay', {
        body: { imageBase64: base64 }
      });

      // Check for rate limiting
      if (error) {
        const errorMessage = error.message?.toLowerCase() || '';
        
        // Handle rate limit errors
        if (errorMessage.includes('rate') || errorMessage.includes('429') || errorMessage.includes('too many')) {
          const retryAfter = 30; // Default retry after 30 seconds
          
          setRateLimitInfo({
            isRateLimited: true,
            retryAfter,
            message: 'High demand - your request is queued',
          });

          // If we haven't exceeded max retries, queue for retry
          if (extraction.retryCount < extraction.maxRetries) {
            const updatedExtraction: QueuedExtraction = {
              ...extraction,
              status: 'retrying',
              retryCount: extraction.retryCount + 1,
              retryAfter,
            };
            
            setQueue(prev => prev.map(q => 
              q.id === extraction.id ? updatedExtraction : q
            ));

            // Schedule retry with exponential backoff
            const delay = baseRetryDelay * Math.pow(2, extraction.retryCount);
            await new Promise(resolve => setTimeout(resolve, delay));
            
            // Clear rate limit info after delay
            setRateLimitInfo(null);
            
            // Retry
            return processExtraction(updatedExtraction);
          }
        }

        throw new Error(error.message);
      }

      if (data?.error) {
        // Check if the error is a rate limit from the response body
        if (data.error === 'rate_limited' || data.rateLimited) {
          const retryAfter = data.retryAfter || 30;
          
          setRateLimitInfo({
            isRateLimited: true,
            retryAfter,
            queuePosition: data.queuePosition,
            message: data.message || 'High demand - please wait',
          });

          if (extraction.retryCount < extraction.maxRetries) {
            const updatedExtraction: QueuedExtraction = {
              ...extraction,
              status: 'retrying',
              retryCount: extraction.retryCount + 1,
              retryAfter,
            };
            
            setQueue(prev => prev.map(q => 
              q.id === extraction.id ? updatedExtraction : q
            ));

            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            setRateLimitInfo(null);
            
            return processExtraction(updatedExtraction);
          }
        }
        
        throw new Error(data.error);
      }

      const result: QueuedExtraction = {
        ...extraction,
        status: 'completed',
        result: {
          legs: data?.legs || [],
          totalOdds: data?.totalOdds,
          stake: data?.stake,
          earliestGameTime: data?.earliestGameTime,
        },
      };

      setQueue(prev => prev.map(q => 
        q.id === extraction.id ? result : q
      ));

      return result;

    } catch (err) {
      const failedExtraction: QueuedExtraction = {
        ...extraction,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
      };

      setQueue(prev => prev.map(q => 
        q.id === extraction.id ? failedExtraction : q
      ));

      return failedExtraction;
    }
  }, [baseRetryDelay]);

  // Process the queue with concurrency control
  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    
    processingRef.current = true;
    setIsProcessing(true);
    abortControllerRef.current = new AbortController();

    const queuedItems = queue.filter(q => q.status === 'queued');
    const results: QueuedExtraction[] = [];

    // Process in batches of maxConcurrent
    for (let i = 0; i < queuedItems.length; i += maxConcurrent) {
      // Check for abort
      if (abortControllerRef.current?.signal.aborted) {
        break;
      }

      const batch = queuedItems.slice(i, i + maxConcurrent);
      setActiveCount(batch.length);

      try {
        const batchResults = await Promise.all(
          batch.map(item => processExtraction(item))
        );

        results.push(...batchResults);

        // Call completion callback for each
        batchResults.forEach(result => {
          onExtractionComplete?.(result);
        });

      } catch (err) {
        console.error('Batch processing error:', err);
      }

      // Small delay between batches to avoid overwhelming
      if (i + maxConcurrent < queuedItems.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    setActiveCount(0);
    setIsProcessing(false);
    processingRef.current = false;
    abortControllerRef.current = null;

    // Call all complete callback
    onAllComplete?.(results);

    return results;
  }, [queue, maxConcurrent, processExtraction, onExtractionComplete, onAllComplete]);

  // Start processing the queue
  const startProcessing = useCallback(async () => {
    return processQueue();
  }, [processQueue]);

  // Cancel a specific extraction
  const cancelExtraction = useCallback((id: string) => {
    setQueue(prev => prev.map(q => 
      q.id === id && (q.status === 'queued' || q.status === 'retrying') 
        ? { ...q, status: 'cancelled' as ExtractionStatus } 
        : q
    ));
  }, []);

  // Cancel all pending extractions
  const cancelAll = useCallback(() => {
    abortControllerRef.current?.abort();
    
    setQueue(prev => prev.map(q => 
      q.status === 'queued' || q.status === 'retrying' || q.status === 'processing'
        ? { ...q, status: 'cancelled' as ExtractionStatus }
        : q
    ));
    
    setIsProcessing(false);
    processingRef.current = false;
    setRateLimitInfo(null);
  }, []);

  // Clear completed/failed/cancelled extractions
  const clearCompleted = useCallback(() => {
    setQueue(prev => {
      // Revoke object URLs before removing
      prev.filter(q => 
        q.status === 'completed' || q.status === 'failed' || q.status === 'cancelled'
      ).forEach(q => URL.revokeObjectURL(q.preview));
      
      return prev.filter(q => 
        q.status !== 'completed' && q.status !== 'failed' && q.status !== 'cancelled'
      );
    });
  }, []);

  // Clear entire queue
  const clearQueue = useCallback(() => {
    queue.forEach(q => URL.revokeObjectURL(q.preview));
    setQueue([]);
    setRateLimitInfo(null);
  }, [queue]);

  // Get queue statistics
  const stats = {
    total: queue.length,
    queued: queue.filter(q => q.status === 'queued').length,
    processing: queue.filter(q => q.status === 'processing').length,
    retrying: queue.filter(q => q.status === 'retrying').length,
    completed: queue.filter(q => q.status === 'completed').length,
    failed: queue.filter(q => q.status === 'failed').length,
    cancelled: queue.filter(q => q.status === 'cancelled').length,
  };

  return {
    queue,
    isProcessing,
    activeCount,
    rateLimitInfo,
    stats,
    addToQueue,
    startProcessing,
    cancelExtraction,
    cancelAll,
    clearCompleted,
    clearQueue,
    getQueuePosition,
    getEstimatedWaitTime,
  };
}
