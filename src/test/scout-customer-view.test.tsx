import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ data: [], error: null }) }) }) }),
    }),
    functions: { invoke: vi.fn() },
  },
}));

// Mock react-query hooks used by child components
vi.mock('@/hooks/useDeepSweetSpots', () => ({
  useDeepSweetSpots: () => ({ data: { spots: [] }, isLoading: false }),
}));
vi.mock('@/hooks/useSweetSpotLiveData', () => ({
  useSweetSpotLiveData: (spots: any[]) => ({ spots, isLoading: false }),
}));
vi.mock('@/hooks/useCustomerWhaleSignals', () => ({
  useCustomerWhaleSignals: () => ({ data: new Map() }),
}));

// Mock react-query QueryClientProvider
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQuery: () => ({ data: [], isLoading: false }),
  };
});

import { RiskModeProvider } from '@/contexts/RiskModeContext';
import { CustomerConfidenceDashboard } from '@/components/scout/CustomerConfidenceDashboard';
import { CustomerAIWhisper } from '@/components/scout/CustomerAIWhisper';
import { CustomerRiskToggle } from '@/components/scout/CustomerRiskToggle';
import { demoConfidencePicks, demoWhisperPicks, demoWhaleSignals } from '@/data/demoScoutData';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <RiskModeProvider>{children}</RiskModeProvider>;
}

describe('CustomerConfidenceDashboard', () => {
  it('renders nothing when picks is empty', () => {
    const { container } = render(
      <Wrapper><CustomerConfidenceDashboard picks={[]} /></Wrapper>
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders all demo picks with heat percentages', () => {
    render(
      <Wrapper><CustomerConfidenceDashboard picks={demoConfidencePicks} /></Wrapper>
    );
    expect(screen.getByText('Confidence Dashboard')).toBeInTheDocument();
    for (const pick of demoConfidencePicks) {
      expect(screen.getByText(pick.playerName)).toBeInTheDocument();
    }
  });

  it('shows survival percentage', () => {
    render(
      <Wrapper><CustomerConfidenceDashboard picks={demoConfidencePicks} /></Wrapper>
    );
    expect(screen.getByText(/survival/i)).toBeInTheDocument();
  });

  it('calculates heat correctly for over picks', () => {
    const overPick = [{ playerName: 'Test', propType: 'points', line: 20, currentValue: 15, side: 'over' }];
    render(
      <Wrapper><CustomerConfidenceDashboard picks={overPick} /></Wrapper>
    );
    // 15/20 = 75%
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('calculates heat correctly for under picks', () => {
    const underPick = [{ playerName: 'Test', propType: 'points', line: 20, currentValue: 5, side: 'UNDER' }];
    render(
      <Wrapper><CustomerConfidenceDashboard picks={underPick} /></Wrapper>
    );
    // (20-5)/20 = 75%
    expect(screen.getByText('75%')).toBeInTheDocument();
  });
});

describe('CustomerAIWhisper', () => {
  it('shows default message when no significant signals', () => {
    const picks = [{ playerName: 'Nobody', propType: 'points', line: 20, currentValue: 5, gameProgress: 0.2 }];
    render(<CustomerAIWhisper picks={picks} />);
    expect(screen.getByText(/monitoring all picks/i)).toBeInTheDocument();
  });

  it('generates pacing insight for over pick', () => {
    const picks = [{
      playerName: 'Star Player',
      propType: 'points',
      line: 20,
      currentValue: 15, // 75% > 60% threshold, progress < 0.6
      side: 'over',
      gameProgress: 0.4,
    }];
    render(<CustomerAIWhisper picks={picks} />);
    expect(screen.getByText(/star player is pacing/i)).toBeInTheDocument();
  });

  it('generates "almost there" insight', () => {
    const picks = [{
      playerName: 'Closer',
      propType: 'rebounds',
      line: 10,
      currentValue: 9, // needs 1 more, progress > 0.75, pace >= 85%
      side: 'over',
      gameProgress: 0.8,
    }];
    render(<CustomerAIWhisper picks={picks} />);
    expect(screen.getByText(/almost there/i)).toBeInTheDocument();
  });

  it('detects STEAM signal from demo whale signals', () => {
    const picks = [{
      playerName: 'LeBron James',
      propType: 'points',
      line: 24.5,
      currentValue: 5,
      side: 'over',
      gameProgress: 0.2,
    }];
    render(<CustomerAIWhisper picks={picks} signals={demoWhaleSignals} />);
    expect(screen.getByText(/sharp money detected/i)).toBeInTheDocument();
  });

  it('detects DIVERGENCE signal from demo whale signals', () => {
    const picks = [{
      playerName: 'Jayson Tatum',
      propType: 'rebounds',
      line: 8.5,
      currentValue: 2,
      side: 'over',
      gameProgress: 0.2,
    }];
    render(<CustomerAIWhisper picks={picks} signals={demoWhaleSignals} />);
    expect(screen.getByText(/whale activity/i)).toBeInTheDocument();
  });

  it('renders dot indicators when multiple insights exist', () => {
    render(<CustomerAIWhisper picks={demoWhisperPicks} signals={demoWhaleSignals} />);
    // Multiple insights should produce dot indicators
    const dots = document.querySelectorAll('.rounded-full');
    expect(dots.length).toBeGreaterThan(1);
  });
});

describe('CustomerRiskToggle', () => {
  it('renders all three risk modes', () => {
    render(<Wrapper><CustomerRiskToggle /></Wrapper>);
    expect(screen.getByText('Conservative')).toBeInTheDocument();
    expect(screen.getByText('Balanced')).toBeInTheDocument();
    expect(screen.getByText('Aggressive')).toBeInTheDocument();
  });

  it('shows description for default balanced mode', () => {
    render(<Wrapper><CustomerRiskToggle /></Wrapper>);
    expect(screen.getByText('Standard sizing & timing')).toBeInTheDocument();
  });
});
