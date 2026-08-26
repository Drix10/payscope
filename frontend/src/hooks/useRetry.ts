import { useCallback, useState } from 'react'

export interface RetryConfig {
  maxAttempts?: number
  baseDelayMs?: number
  exponentialBackoff?: boolean
}

export function useRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = {}
) {
  const { maxAttempts = 3, baseDelayMs = 1000, exponentialBackoff = true } = config
  const [isRetrying, setIsRetrying] = useState(false)
  const [attemptNumber, setAttemptNumber] = useState(0)

  const executeWithRetry = useCallback(async (): Promise<T> => {
    let lastError: unknown
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        setAttemptNumber(attempt)
        setIsRetrying(attempt > 1)
        const result = await operation()
        setIsRetrying(false)
        return result
      } catch (error) {
        lastError = error
        
        if (attempt < maxAttempts) {
          const delay = exponentialBackoff 
            ? baseDelayMs * Math.pow(2, attempt - 1)
            : baseDelayMs
          
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }
    
    setIsRetrying(false)
    throw lastError
  }, [operation, maxAttempts, baseDelayMs, exponentialBackoff])

  const reset = useCallback(() => {
    setIsRetrying(false)
    setAttemptNumber(0)
  }, [])

  return {
    executeWithRetry,
    isRetrying,
    attemptNumber,
    reset
  }
}
