import { createContext, useContext } from "react";

export const HubPersonalContext = createContext(false);
export const usePersonalHub = () => useContext(HubPersonalContext);
