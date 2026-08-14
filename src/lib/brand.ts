export type AppBrand = 'interact' | 'viewsonic'

export const APP_BRAND: AppBrand = import.meta.env.VITE_APP_BRAND === 'viewsonic' ? 'viewsonic' : 'interact'

export const isViewSonicBrand = APP_BRAND === 'viewsonic'
