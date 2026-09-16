import { createContext } from "react";

export type ModelFavorites = {
  values: string[];
  ready: boolean;
  toggle: (key: string, enabled: boolean) => Promise<void>;
};
export const ModelFavoritesContext = createContext<ModelFavorites | null>(null);

