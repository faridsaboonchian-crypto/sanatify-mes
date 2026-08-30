/**
 * تبدیل بومی تاریخ میلادی به جلالی (شمسی) با الگوریتم ۱۰۰٪ ریاضی بدون وابستگی خارجی
 */
export function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
    const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 335];
    let jy: number;
    if (gy > 1600) {
        jy = 979;
        gy -= 1600;
    } else {
        jy = 0;
        gy -= 621;
    }
    const gy2 = (gm > 2) ? (gy + 1) : gy;
    let days = (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) - 80 + gd + g_d_m[gm - 1];
    jy += 33 * Math.floor(days / 12053);
    days %= 12053;
    jy += 4 * Math.floor(days / 1461);
    days %= 1461;
    if (days > 365) {
        jy += Math.floor((days - 1) / 365);
        days = (days - 1) % 365;
    }
    let jm: number;
    let jd: number;
    if (days < 186) {
        jm = 1 + Math.floor(days / 31);
        jd = 1 + (days % 31);
    } else {
        jm = 7 + Math.floor((days - 186) / 30);
        jd = 1 + ((days - 186) % 30);
    }
    return [jy, jm, jd];
}

/**
 * تبدیل ارقام انگلیسی به فارسی همراه با مهار ممیز اعشاری بومی و علامت درصد فارسی
 */
export function formatNumberFa(num: number | string): string {
    if (num === null || num === undefined) return '';
    let str = String(num);
    const englishDigits = /0|1|2|3|4|5|6|7|8|9/g;
    const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    str = str.replace(englishDigits, (w) => persianDigits[parseInt(w, 10)]);
    str = str.replace(/%/g, '٪'); // تبدیل نماد درصد انگلیسی به فارسی
    str = str.replace(/\./g, '٫'); // تبدیل ممیز اعشاری انگلیسی به ممیز اعشاری بومی فارسی (ممیز حسابداری)
    return str;
}

/**
 * فرمت‌سازی تاریخ ISO به فرمت متنی شمسی
 */
export function formatJalaliDate(isoString: string | Date): string {
    try {
        const date = typeof isoString === 'string' ? new Date(isoString) : isoString;
        if (isNaN(date.getTime())) return 'تاریخ نامعتبر';
        const [jy, jm, jd] = gregorianToJalali(date.getFullYear(), date.getMonth() + 1, date.getDate());
        return formatNumberFa(`${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`);
    } catch {
        return '---';
    }
}

/**
 * فرمت‌سازی ساعت و تاریخ شمسی
 */
export function formatJalaliDateTime(isoString: string | Date): string {
    try {
        const date = typeof isoString === 'string' ? new Date(isoString) : isoString;
        if (isNaN(date.getTime())) return 'تاریخ نامعتبر';
        const [jy, jm, jd] = gregorianToJalali(date.getFullYear(), date.getMonth() + 1, date.getDate());
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return formatNumberFa(`${hours}:${minutes} - ${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`);
    } catch {
        return '---';
    }
}

/**
 * تبدیل دقایق کارگاهی به فرمت فارسی خوانا
 */
export function formatDurationFa(minutes: number): string {
    if (!minutes || isNaN(minutes) || minutes <= 0) return formatNumberFa('۰ دقیقه');
    if (minutes < 60) {
        return formatNumberFa(`${minutes} دقیقه`);
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) {
        return formatNumberFa(`${hours} ساعت`);
    }
    return formatNumberFa(`${hours} ساعت و ${mins} دقیقه`);
}