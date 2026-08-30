/**
 * تولید شناسه یکتای بومی بدون نیاز به موتور رمزنگاری سیستم‌عامل (مقاوم در برابر تداخل و مناسب برای آفلاین-اول)
 */
export function generateUniqueId(prefix: string = 'id'): string {
    const timestamp = Date.now().toString(36); // زمان جاری در مبنای ۳۶
    const randomPart1 = Math.random().toString(36).substring(2, 8); // بخش تصادفی اول
    const randomPart2 = Math.random().toString(36).substring(2, 8); // بخش تصادفی دوم

    return `${prefix}-${timestamp}-${randomPart1}-${randomPart2}`;
}