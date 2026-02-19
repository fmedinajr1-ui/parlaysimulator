import React, { createContext, useContext, useState, type ReactNode } from 'react';

export type RiskMode = 'conservative' | 'balanced' | 'aggressive';

interface RiskModeContextValue {
  riskMode: RiskMode;
  setRiskMode: (mode: RiskMode) => void;
  kellyMultiplier: number;
  hedgeBuffer: number;
}

const RISK_CONFIG: Record<RiskMode, { kellyMultiplier: number; hedgeBuffer: number }> = {
  conservative: { kellyMultiplier: 0.25, hedgeBuffer: 1 },
  balanced: { kellyMultiplier: 0.5, hedgeBuffer: 0 },
  aggressive: { kellyMultiplier: 1.0, hedgeBuffer: -1 },
};

const RiskModeContext = createContext<RiskModeContextValue | undefined>(undefined);

export function RiskModeProvider({ children }: { children: ReactNode }) {
  const [riskMode, setRiskMode] = useState<RiskMode>('balanced');
  const config = RISK_CONFIG[riskMode];

  return (
    <RiskModeContext.Provider value={{ riskMode, setRiskMode, ...config }}>
      {children}
    </RiskModeContext.Provider>
  );
}

export function useRiskMode() {
  const ctx = useContext(RiskModeContext);
  if (!ctx) throw new Error('useRiskMode must be used within RiskModeProvider');
  return ctx;
}
