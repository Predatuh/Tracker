import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { admin_api, auth_api } from '../api/apiClient';

const TRACKER_STORAGE_KEY = 'princess-trackers.currentTrackerId';
const ACCESS_MODE_KEY = 'princess-trackers.accessMode';

const AppContext = createContext(null);

function readStoredTrackerId() {
  const value = window.localStorage.getItem(TRACKER_STORAGE_KEY);
  if (value === null || value === '') {
    return null;
  }
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
}

export function AppProvider({ children }) {
  const [booting, setBooting] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [trackers, setTrackers] = useState([]);
  const [currentTrackerId, setCurrentTrackerIdState] = useState(() => readStoredTrackerId());
  const [trackerSettings, setTrackerSettings] = useState({});
  const [accessMode, setAccessMode] = useState(() => window.localStorage.getItem(ACCESS_MODE_KEY) || null);

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      try {
        const [sessionResponse, trackersResponse] = await Promise.all([
          auth_api.me(),
          admin_api.listTrackers(),
        ]);

        if (!mounted) {
          return;
        }

        const trackerList = trackersResponse.data.data || [];
        const resolvedUser = sessionResponse.data.user;
        setCurrentUser(resolvedUser || null);
        setTrackers(trackerList);

        if (resolvedUser && accessMode !== 'user') {
          setAccessMode('user');
          window.localStorage.setItem(ACCESS_MODE_KEY, 'user');
        }

        const preferredTrackerId = readStoredTrackerId();
        const nextTracker = trackerList.find((tracker) => tracker.id === preferredTrackerId) || null;
        setCurrentTrackerIdState(nextTracker ? nextTracker.id : null);
      } catch (error) {
        if (!mounted) {
          return;
        }
        setCurrentUser(null);
        setTrackers([]);
        setCurrentTrackerIdState(null);
      } finally {
        if (mounted) {
          setBooting(false);
        }
      }
    };

    bootstrap();

    return () => {
      mounted = false;
    };
  }, [accessMode]);

  useEffect(() => {
    if (!currentTrackerId) {
      setTrackerSettings({});
      return;
    }

    let mounted = true;
    admin_api.getTrackerSettings(currentTrackerId)
      .then((response) => {
        if (mounted) {
          setTrackerSettings(response.data.data || {});
        }
      })
      .catch(() => {
        if (mounted) {
          setTrackerSettings({});
        }
      });

    return () => {
      mounted = false;
    };
  }, [currentTrackerId]);

  const setCurrentTrackerId = (trackerId) => {
    const resolvedTrackerId = trackerId ? Number(trackerId) : null;
    setCurrentTrackerIdState(resolvedTrackerId);
    if (resolvedTrackerId) {
      window.localStorage.setItem(TRACKER_STORAGE_KEY, String(resolvedTrackerId));
    } else {
      window.localStorage.removeItem(TRACKER_STORAGE_KEY);
    }
  };

  const login = async (payload) => {
    const response = await auth_api.login(payload);
    setCurrentUser(response.data.user || null);
    setAccessMode('user');
    window.localStorage.setItem(ACCESS_MODE_KEY, 'user');
    return response.data.user;
  };

  const register = async (payload) => {
    const response = await auth_api.register(payload);
    setCurrentUser(response.data.user || null);
    setAccessMode('user');
    window.localStorage.setItem(ACCESS_MODE_KEY, 'user');
    return response.data.user;
  };

  const continueAsGuest = () => {
    setCurrentUser(null);
    setAccessMode('guest');
    window.localStorage.setItem(ACCESS_MODE_KEY, 'guest');
  };

  const logout = async () => {
    if (currentUser) {
      await auth_api.logout().catch(() => null);
    }
    setCurrentUser(null);
    setAccessMode(null);
    window.localStorage.removeItem(ACCESS_MODE_KEY);
  };

  const currentTracker = useMemo(() => {
    if (!trackers.length || !currentTrackerId) {
      return null;
    }
    return trackers.find((tracker) => tracker.id === currentTrackerId) || null;
  }, [currentTrackerId, trackers]);

  const isAdmin = Boolean(currentUser?.is_admin || currentUser?.role === 'admin');

  const hasPermission = (permission) => {
    if (isAdmin) {
      return true;
    }
    return Boolean(currentUser?.permissions?.includes(permission));
  };

  const value = {
    accessMode,
    booting,
    canAccessApp: Boolean(currentUser || accessMode === 'guest'),
    continueAsGuest,
    currentTracker,
    currentTrackerId: currentTracker?.id || null,
    currentUser,
    hasPermission,
    isAdmin,
    login,
    logout,
    register,
    setCurrentTrackerId,
    trackerSettings,
    trackers,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used inside AppProvider');
  }
  return context;
}