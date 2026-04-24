import { useState, useEffect } from 'react'
import type { Config } from '../types.js'
import { fetchConfig } from '../api.js'

export function useConfig() {
  const [config, setConfig] = useState<Config | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchConfig()
      .then(setConfig)
      .catch((e) => setError(e.message))
  }, [])

  return { config, error }
}
