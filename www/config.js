'use strict';
/*
 * Firebase project built into the app. When both values are filled in, the main phone
 * creates the family with one tap and other phones join with just the short pairing code.
 * Empty values: the app asks for them when creating a family and uses the long invite code.
 */
// 5.4: Programla gelen ortak Firebase projesi KALDIRILDI — her aile kendi ücretsiz Firebase hesabını kullanır
// (yöneticinin günlük sınırı başkalarınca harcanmasın). Kurulum: ❓ yardım ya da FB_REHBER.
const BUILTIN_FB = { apiKey: '', projectId: '' };
const FB_REHBER = 'https://github.com/departures-mil/duyurular/blob/main/firebase-kurulum.md';
// Eski ortak projede yalnız yöneticinin ailesi kalır; diğer ailelerin bağlantısı kesilir (kayıtlar telefonda kalır).
const ESKI_ORTAK_PROJE = 'aileajandasi-f65c9';
const YONETICI_AILE = 'R69ZH34686';
