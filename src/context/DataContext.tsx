import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface DataContextType {
  refreshKey: number;
  triggerRefresh: () => void;
}

const DataContext = createContext<DataContextType>({ refreshKey: 0, triggerRefresh: () => {} });

export function DataProvider({ children }: { children: ReactNode }) {
  const [refreshKey, setRefreshKey] = useState(0);

  const triggerRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <DataContext.Provider value={{ refreshKey, triggerRefresh }}>
      {children}
    </DataContext.Provider>
  );
}

export function useDataRefresh() {
  return useContext(DataContext);
}
