/**
 * useNavigation Hook
 *
 * Purpose: Manages dashboard view navigation state and menu selection
 * Props: None - Self-contained hook
 * State: currentView (DashboardView), selectedMenuItem (string)
 * Extension: Add navigation history, breadcrumbs, or view transitions
 */

import { useCallback, useState } from 'react';
import type { DashboardView, MenuItem } from '../types.js';

/**
 * Navigation state and actions
 */
interface NavigationState {
  /** Current active view */
  currentView: DashboardView;
  /** Currently selected menu item value */
  selectedMenuItem: string | null;
}

/**
 * Navigation actions
 */
interface NavigationActions {
  /** Navigate to a specific view */
  navigateTo: (view: DashboardView) => void;
  /** Navigate back to menu */
  goToMenu: () => void;
  /** Handle menu item selection */
  handleMenuSelect: (item: MenuItem) => void;
  /** Check if a view is active */
  isActive: (view: DashboardView) => boolean;
}

/**
 * Hook for managing dashboard navigation
 * @param onQuit - Callback when user selects quit
 * @returns Navigation state and actions
 */
export function useNavigation(onQuit?: () => void): NavigationState & NavigationActions {
  const [currentView, setCurrentView] = useState<DashboardView>('MENU');
  const [selectedMenuItem, setSelectedMenuItem] = useState<string | null>(null);

  const navigateTo = useCallback((view: DashboardView) => {
    setCurrentView(view);
  }, []);

  const goToMenu = useCallback(() => {
    setCurrentView('MENU');
    setSelectedMenuItem(null);
  }, []);

  const handleMenuSelect = useCallback(
    (item: MenuItem) => {
      setSelectedMenuItem(item.value);

      switch (item.value) {
        case 'import':
          setCurrentView('IMPORT');
          break;
        case 'campaign':
          setCurrentView('CAMPAIGN');
          break;
        case 'unsubscribe':
          setCurrentView('UNSUBSCRIBE');
          break;
        case 'analytics':
          setCurrentView('ANALYTICS');
          break;
        case 'quit':
          onQuit?.();
          break;
        default:
          // Handle custom menu items
          break;
      }
    },
    [onQuit]
  );

  const isActive = useCallback(
    (view: DashboardView) => {
      return currentView === view;
    },
    [currentView]
  );

  return {
    currentView,
    selectedMenuItem,
    navigateTo,
    goToMenu,
    handleMenuSelect,
    isActive,
  };
}
