const isNode = typeof window === 'undefined';
const windowObj = isNode ? { localStorage: new Map() } : window;
const storage = windowObj.localStorage;

const toSnakeCase = (str) => {
	return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

const getAppParamValue = (paramName, { defaultValue = undefined, removeFromUrl = false } = {}) => {
	if (isNode) {
		return defaultValue;
	}
	const storageKey = `base44_${toSnakeCase(paramName)}`;
	const urlParams = new URLSearchParams(window.location.search);
	const searchParam = urlParams.get(paramName);
	if (removeFromUrl) {
		urlParams.delete(paramName);
		const newUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ""
			}${window.location.hash}`;
		window.history.replaceState({}, document.title, newUrl);
	}
	if (searchParam) {
		storage.setItem(storageKey, searchParam);
		return searchParam;
	}
	if (defaultValue) {
		storage.setItem(storageKey, defaultValue);
		return defaultValue;
	}
	const storedValue = storage.getItem(storageKey);
	if (storedValue) {
		return storedValue;
	}
	return null;
}

const getAppParams = () => {
	// CORRECCIÓN CRÍTICA (sesión que no persistía): "clear_access_token=true" llega
	// por la URL una única vez — tras el logout del servidor. Es UNA INSTRUCCIÓN
	// PUNTUAL, nunca un estado persistente. El código anterior lo guardaba en
	// localStorage (vía getAppParamValue) y, en CADA arranque posterior sin el
	// parámetro en la URL, volvía a leer ese "true" caducado y BORRABA el token
	// recién restaurado → login obligatorio en cada reapertura de la aplicación.
	// Regla: solo limpia los tokens si el parámetro está EN LA URL en este arranque,
	// y el flag jamás sobrevive en storage (además sana el estado ya envenenado).
	const clearInUrl = !isNode && new URLSearchParams(window.location.search).get("clear_access_token") === "true";
	if (clearInUrl) {
		storage.removeItem('base44_access_token');
		storage.removeItem('token');
	}
	storage.removeItem('base44_clear_access_token');
	return {
		appId: getAppParamValue("app_id", { defaultValue: import.meta.env.VITE_BASE44_APP_ID }),
		token: getAppParamValue("access_token", { removeFromUrl: true }),
		fromUrl: getAppParamValue("from_url", { defaultValue: window.location.href }),
		functionsVersion: getAppParamValue("functions_version", { defaultValue: import.meta.env.VITE_BASE44_FUNCTIONS_VERSION }),
		appBaseUrl: getAppParamValue("app_base_url", { defaultValue: import.meta.env.VITE_BASE44_APP_BASE_URL }),
	}
}


export const appParams = {
	...getAppParams()
}