var CONSTANTS = [/* 0 */"module", /* 1 */"undefined", /* 2 */"exports", /* 3 */"window", /* 4 */"TEST_OUTPUT", /* 5 */undefined, /* 6 */0, /* 7 */"", /* 8 */"Array", /* 9 */1116352408, /* 10 */1899447441, /* 11 */1245643825, /* 12 */373957723, /* 13 */961987163, /* 14 */1508970993, /* 15 */1841331548, /* 16 */1424204075, /* 17 */670586216, /* 18 */310598401, /* 19 */607225278, /* 20 */1426881987, /* 21 */1925078388, /* 22 */2132889090, /* 23 */1680079193, /* 24 */1046744716, /* 25 */459576895, /* 26 */272742522, /* 27 */264347078, /* 28 */604807628, /* 29 */770255983, /* 30 */1249150122, /* 31 */1555081692, /* 32 */1996064986, /* 33 */1740746414, /* 34 */1473132947, /* 35 */1341970488, /* 36 */1084653625, /* 37 */958395405, /* 38 */710438585, /* 39 */113926993, /* 40 */338241895, /* 41 */666307205, /* 42 */773529912, /* 43 */1294757372, /* 44 */1396182291, /* 45 */1695183700, /* 46 */1986661051, /* 47 */2117940946, /* 48 */1838011259, /* 49 */1564481375, /* 50 */1474664885, /* 51 */1035236496, /* 52 */949202525, /* 53 */778901479, /* 54 */694614492, /* 55 */200395387, /* 56 */275423344, /* 57 */430227734, /* 58 */506948616, /* 59 */659060556, /* 60 */883997877, /* 61 */958139571, /* 62 */1322822218, /* 63 */1537002063, /* 64 */1747873779, /* 65 */1955562222, /* 66 */2024104815, /* 67 */2067236844, /* 68 */1933114872, /* 69 */1866530822, /* 70 */1538233109, /* 71 */1090935817, /* 72 */965641998, /* 73 */"hex", /* 74 */"b64", /* 75 */"any", /* 76 */"hex_hmac", /* 77 */"b64_hmac", /* 78 */"any_hmac", /* 79 */"abc", /* 80 */"toLowerCase", /* 81 */"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", /* 82 */"length", /* 83 */8, /* 84 */16, /* 85 */909522486, /* 86 */1549556828, /* 87 */1, /* 88 */"concat", /* 89 */512, /* 90 */256, /* 91 */"0123456789ABCDEF", /* 92 */"0123456789abcdef", /* 93 */"charCodeAt", /* 94 */"charAt", /* 95 */4, /* 96 */15, /* 97 */"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", /* 98 */2, /* 99 */6, /* 100 */3, /* 101 */63, /* 102 */"Math", /* 103 */"ceil", /* 104 */"floor", /* 105 */"log", /* 106 */55296, /* 107 */56319, /* 108 */56320, /* 109 */57343, /* 110 */65536, /* 111 */1023, /* 112 */10, /* 113 */127, /* 114 */"String", /* 115 */"fromCharCode", /* 116 */2047, /* 117 */192, /* 118 */31, /* 119 */128, /* 120 */65535, /* 121 */224, /* 122 */12, /* 123 */2097151, /* 124 */240, /* 125 */18, /* 126 */7, /* 127 */255, /* 128 */5, /* 129 */24, /* 130 */32, /* 131 */13, /* 132 */22, /* 133 */11, /* 134 */25, /* 135 */17, /* 136 */19, /* 137 */28, /* 138 */34, /* 139 */39, /* 140 */14, /* 141 */41, /* 142 */61, /* 143 */1779033703, /* 144 */1150833019, /* 145 */1013904242, /* 146 */1521486534, /* 147 */1359893119, /* 148 */1694144372, /* 149 */528734635, /* 150 */1541459225, /* 151 */64, /* 152 */9];
var BYTECODE = [4, 1, 47, 3, 76, 0, 102, 0, 0, 42, 4, 3, 0, 5, 2, 4, 38, 3, 0, 0, 0, 4, 1, 0, 27, 5, 3, 4, 40, 5, 43, 2, 3, 0, 0, 0, 4, 2, 0, 9, 3, 4, 2, 38, 3, 3, 0, 0, 4, 1, 0, 27, 5, 3, 4, 40, 5, 70, 2, 3, 3, 0, 0, 4, 4, 0, 9, 3, 4, 2, 0, 3, 5, 0, 45, 3, 4, 1, 47, 36, 967, 1, 7, 3, 0, 1, 13, 1, 11, 1, 16, 5, 4, 36, 47, 36, 1001, 1, 7, 3, 0, 1, 14, 1, 11, 1, 16, 5, 5, 36, 47, 36, 1035, 2, 8, 3, 0, 1, 15, 1, 11, 1, 16, 5, 6, 36, 47, 36, 1070, 2, 9, 3, 0, 1, 13, 1, 12, 1, 16, 5, 7, 36, 47, 36, 1113, 2, 9, 3, 0, 1, 14, 1, 12, 1, 16, 5, 8, 36, 47, 36, 1156, 3, 10, 3, 0, 1, 15, 1, 12, 1, 16, 5, 9, 36, 47, 36, 1200, 0, 5, 1, 0, 1, 4, 5, 10, 36, 47, 36, 1243, 1, 9, 3, 0, 1, 20, 1, 34, 1, 19, 5, 11, 36, 47, 36, 1294, 2, 15, 3, 0, 1, 19, 1, 34, 1, 20, 5, 12, 36, 47, 36, 1561, 1, 12, 1, 0, 1, 2, 5, 13, 36, 47, 36, 1741, 1, 14, 1, 0, 1, 3, 5, 14, 36, 47, 36, 2096, 2, 21, 0, 0, 5, 15, 36, 47, 36, 2711, 1, 15, 0, 0, 5, 16, 36, 47, 36, 3314, 1, 11, 0, 0, 5, 17, 36, 47, 36, 3447, 1, 11, 0, 0, 5, 18, 36, 47, 36, 3580, 1, 11, 0, 0, 5, 19, 36, 47, 36, 3777, 1, 11, 0, 0, 5, 20, 36, 47, 36, 3902, 2, 7, 0, 0, 5, 21, 36, 47, 36, 3932, 2, 5, 0, 0, 5, 22, 36, 47, 36, 3946, 3, 8, 0, 0, 5, 23, 36, 47, 36, 3971, 3, 8, 0, 0, 5, 24, 36, 47, 36, 4001, 1, 7, 1, 0, 1, 21, 5, 25, 36, 47, 36, 4058, 1, 7, 1, 0, 1, 21, 5, 26, 36, 47, 36, 4115, 1, 7, 2, 0, 1, 21, 1, 22, 5, 27, 36, 47, 36, 4172, 1, 7, 2, 0, 1, 21, 1, 22, 5, 28, 36, 47, 36, 4229, 1, 7, 1, 0, 1, 21, 5, 29, 36, 47, 36, 4286, 1, 7, 1, 0, 1, 21, 5, 30, 36, 47, 36, 4343, 1, 7, 2, 0, 1, 21, 1, 22, 5, 31, 36, 47, 36, 4400, 1, 7, 2, 0, 1, 21, 1, 22, 5, 32, 36, 47, 36, 4457, 2, 28, 8, 0, 1, 35, 1, 28, 1, 27, 1, 26, 1, 23, 1, 33, 1, 25, 1, 24, 5, 34, 36, 47, 36, 5288, 2, 9, 0, 0, 5, 35, 36, 0, 36, 6, 0, 5, 2, 36, 0, 36, 7, 0, 5, 3, 36, 2, 36, 8, 0, 0, 37, 9, 0, 0, 38, 10, 0, 0, 39, 11, 0, 32, 40, 39, 0, 39, 12, 0, 32, 41, 39, 0, 39, 13, 0, 0, 42, 14, 0, 0, 43, 15, 0, 32, 44, 43, 0, 43, 16, 0, 32, 45, 43, 0, 43, 17, 0, 32, 46, 43, 0, 43, 18, 0, 0, 47, 19, 0, 0, 48, 20, 0, 0, 49, 21, 0, 0, 50, 22, 0, 32, 51, 50, 0, 50, 23, 0, 32, 52, 50, 0, 50, 24, 0, 32, 53, 50, 0, 50, 25, 0, 32, 54, 50, 0, 50, 26, 0, 32, 55, 50, 0, 50, 27, 0, 0, 56, 28, 0, 0, 57, 29, 0, 0, 58, 30, 0, 0, 59, 31, 0, 0, 60, 32, 0, 0, 61, 33, 0, 32, 62, 61, 0, 61, 34, 0, 32, 63, 61, 0, 61, 35, 0, 32, 64, 61, 0, 61, 36, 0, 32, 65, 61, 0, 61, 37, 0, 32, 66, 61, 0, 61, 38, 0, 32, 67, 61, 0, 61, 39, 0, 0, 68, 40, 0, 0, 69, 41, 0, 0, 70, 42, 0, 0, 71, 43, 0, 0, 72, 44, 0, 0, 73, 45, 0, 0, 74, 46, 0, 0, 75, 47, 0, 32, 76, 75, 0, 75, 48, 0, 32, 77, 75, 0, 75, 49, 0, 32, 78, 75, 0, 75, 50, 0, 32, 79, 75, 0, 75, 51, 0, 32, 80, 75, 0, 75, 52, 0, 32, 81, 75, 0, 75, 53, 0, 32, 82, 75, 0, 75, 54, 0, 32, 83, 75, 0, 75, 55, 0, 32, 84, 75, 0, 75, 56, 0, 0, 85, 57, 0, 0, 86, 58, 0, 0, 87, 59, 0, 0, 88, 60, 0, 0, 89, 61, 0, 0, 90, 62, 0, 0, 91, 63, 0, 0, 92, 64, 0, 0, 93, 65, 0, 0, 94, 66, 0, 0, 95, 67, 0, 32, 96, 95, 0, 95, 68, 0, 32, 97, 95, 0, 95, 69, 0, 32, 98, 95, 0, 95, 70, 0, 32, 99, 95, 0, 95, 71, 0, 32, 100, 95, 0, 95, 72, 0, 32, 101, 95, 44, 95, 36, 64, 37, 38, 40, 41, 39, 42, 44, 45, 46, 43, 47, 48, 49, 51, 52, 53, 54, 55, 50, 56, 57, 58, 59, 60, 62, 63, 64, 65, 66, 67, 61, 68, 69, 70, 71, 72, 73, 74, 76, 77, 78, 79, 80, 81, 82, 83, 84, 75, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 96, 97, 98, 99, 100, 101, 5, 33, 95, 0, 36, 73, 0, 0, 37, 74, 0, 0, 38, 75, 0, 0, 39, 76, 0, 0, 40, 77, 0, 0, 41, 78, 0, 49, 42, 6, 36, 4, 37, 8, 38, 9, 39, 7, 40, 8, 41, 9, 45, 42, 0, 36, 5, 0, 45, 36, 4, 2, 3, 3, 0, 3, 4, 1, 3, 5, 2, 42, 6, 5, 1, 0, 42, 5, 4, 1, 6, 42, 4, 3, 1, 5, 45, 4, 0, 3, 5, 0, 45, 3, 4, 2, 3, 3, 0, 3, 4, 1, 3, 5, 2, 42, 6, 5, 1, 0, 42, 5, 4, 1, 6, 42, 4, 3, 1, 5, 45, 4, 0, 3, 5, 0, 45, 3, 4, 3, 3, 4, 0, 3, 5, 1, 3, 6, 2, 42, 7, 6, 1, 0, 42, 6, 5, 1, 7, 42, 5, 4, 2, 6, 1, 45, 5, 0, 4, 5, 0, 45, 4, 4, 3, 3, 4, 0, 3, 5, 1, 3, 6, 2, 42, 7, 6, 1, 0, 3, 6, 2, 42, 8, 6, 1, 1, 42, 6, 5, 2, 7, 8, 42, 5, 4, 1, 6, 45, 5, 0, 4, 5, 0, 45, 4, 4, 3, 3, 4, 0, 3, 5, 1, 3, 6, 2, 42, 7, 6, 1, 0, 3, 6, 2, 42, 8, 6, 1, 1, 42, 6, 5, 2, 7, 8, 42, 5, 4, 1, 6, 45, 5, 0, 4, 5, 0, 45, 4, 4, 4, 3, 5, 0, 3, 6, 1, 3, 7, 2, 42, 8, 7, 1, 0, 3, 7, 2, 42, 9, 7, 1, 1, 42, 7, 6, 2, 8, 9, 42, 6, 5, 2, 7, 2, 45, 6, 0, 5, 5, 0, 45, 5, 4, 1, 3, 2, 0, 0, 3, 79, 0, 42, 4, 2, 1, 3, 0, 2, 80, 0, 8, 3, 4, 2, 43, 2, 4, 3, 0, 0, 3, 81, 0, 28, 4, 2, 3, 45, 4, 0, 2, 5, 0, 45, 2, 4, 2, 3, 3, 0, 3, 4, 1, 3, 5, 2, 42, 6, 5, 1, 0, 0, 5, 82, 0, 8, 7, 0, 5, 0, 5, 83, 0, 13, 8, 7, 5, 42, 5, 4, 2, 6, 8, 42, 4, 3, 1, 5, 45, 4, 0, 3, 5, 0, 45, 3, 4, 3, 3, 9, 0, 42, 10, 9, 1, 0, 5, 4, 10, 0, 9, 82, 0, 8, 10, 4, 9, 0, 9, 84, 0, 23, 11, 10, 9, 40, 11, 1354, 3, 9, 1, 0, 10, 82, 0, 8, 11, 0, 10, 0, 10, 83, 0, 13, 12, 11, 10, 42, 10, 9, 2, 4, 12, 5, 4, 10, 2, 9, 8, 0, 0, 10, 84, 0, 42, 11, 9, 1, 10, 5, 5, 11, 2, 9, 8, 0, 0, 10, 84, 0, 42, 11, 9, 1, 10, 5, 6, 11, 0, 9, 6, 0, 5, 7, 9, 0, 9, 84, 0, 22, 10, 7, 9, 40, 10, 1452, 8, 9, 4, 7, 0, 10, 85, 0, 18, 11, 9, 10, 9, 5, 7, 11, 8, 9, 4, 7, 0, 10, 86, 0, 18, 11, 9, 10, 9, 6, 7, 11, 5, 9, 7, 0, 9, 87, 0, 11, 10, 7, 9, 5, 7, 10, 39, 1393, 3, 9, 1, 0, 10, 88, 0, 8, 11, 5, 10, 3, 10, 0, 42, 12, 10, 1, 1, 43, 10, 5, 11, 1, 12, 0, 11, 89, 0, 0, 12, 82, 0, 8, 13, 1, 12, 0, 12, 83, 0, 13, 14, 13, 12, 11, 12, 11, 14, 42, 11, 9, 2, 10, 12, 5, 8, 11, 3, 9, 2, 3, 10, 1, 0, 11, 88, 0, 8, 12, 6, 11, 43, 11, 6, 12, 1, 8, 0, 12, 89, 0, 0, 13, 90, 0, 11, 14, 12, 13, 42, 12, 10, 2, 11, 14, 42, 10, 9, 1, 12, 45, 10, 0, 9, 5, 0, 45, 9, 4, 2, 54, 1572, 3, 3, 8, 0, 55, 39, 1579, 0, 8, 6, 0, 7, 0, 8, 3, 8, 0, 40, 8, 1594, 0, 8, 91, 0, 5, 9, 8, 39, 1601, 0, 8, 92, 0, 5, 9, 8, 5, 4, 9, 0, 8, 7, 0, 5, 5, 8, 0, 6, 5, 0, 0, 8, 6, 0, 5, 7, 8, 0, 8, 82, 0, 8, 9, 0, 8, 22, 8, 7, 9, 40, 8, 1733, 0, 8, 93, 0, 8, 9, 0, 8, 43, 8, 0, 9, 1, 7, 5, 6, 8, 0, 8, 94, 0, 8, 9, 4, 8, 0, 8, 95, 0, 21, 10, 6, 8, 0, 8, 96, 0, 16, 11, 10, 8, 43, 8, 4, 9, 1, 11, 0, 9, 94, 0, 8, 10, 4, 9, 0, 9, 96, 0, 16, 11, 6, 9, 43, 9, 4, 10, 1, 11, 11, 10, 8, 9, 11, 8, 5, 10, 5, 5, 8, 5, 8, 7, 0, 8, 87, 0, 11, 9, 7, 8, 5, 7, 9, 39, 1622, 45, 5, 0, 8, 5, 0, 45, 8, 4, 2, 54, 1752, 3, 3, 10, 0, 55, 39, 1759, 0, 10, 7, 0, 7, 0, 10, 0, 10, 97, 0, 5, 4, 10, 0, 10, 7, 0, 5, 5, 10, 0, 10, 82, 0, 8, 11, 0, 10, 5, 6, 11, 0, 10, 6, 0, 5, 7, 10, 22, 10, 7, 6, 40, 10, 2088, 0, 10, 93, 0, 8, 11, 0, 10, 43, 10, 0, 11, 1, 7, 0, 11, 84, 0, 19, 12, 10, 11, 0, 10, 87, 0, 11, 11, 7, 10, 22, 10, 11, 6, 40, 10, 1870, 0, 10, 93, 0, 8, 11, 0, 10, 0, 10, 87, 0, 11, 13, 7, 10, 43, 10, 0, 11, 1, 13, 0, 11, 83, 0, 19, 13, 10, 11, 5, 10, 13, 39, 1877, 0, 11, 6, 0, 5, 10, 11, 17, 11, 12, 10, 0, 10, 98, 0, 11, 12, 7, 10, 22, 10, 12, 6, 40, 10, 1923, 0, 10, 93, 0, 8, 12, 0, 10, 0, 10, 98, 0, 11, 13, 7, 10, 43, 10, 0, 12, 1, 13, 5, 12, 10, 39, 1930, 0, 10, 6, 0, 5, 12, 10, 17, 10, 11, 12, 5, 8, 10, 0, 10, 6, 0, 5, 9, 10, 0, 10, 95, 0, 22, 11, 9, 10, 40, 11, 2075, 0, 10, 83, 0, 13, 11, 7, 10, 0, 10, 99, 0, 13, 12, 9, 10, 11, 10, 11, 12, 0, 11, 82, 0, 8, 12, 0, 11, 0, 11, 83, 0, 13, 13, 12, 11, 23, 11, 10, 13, 40, 11, 2010, 3, 10, 0, 11, 11, 5, 10, 5, 5, 11, 39, 2059, 0, 10, 94, 0, 8, 11, 4, 10, 0, 10, 99, 0, 0, 12, 100, 0, 12, 13, 12, 9, 13, 12, 10, 13, 21, 10, 8, 12, 0, 12, 101, 0, 16, 13, 10, 12, 43, 10, 4, 11, 1, 13, 11, 11, 5, 10, 5, 5, 11, 5, 10, 9, 0, 10, 87, 0, 11, 11, 9, 10, 5, 9, 11, 39, 1944, 0, 10, 100, 0, 11, 11, 7, 10, 5, 7, 11, 39, 1791, 45, 5, 0, 10, 5, 0, 45, 10, 4, 3, 0, 13, 82, 0, 8, 14, 1, 13, 5, 4, 14, 2, 13, 8, 0, 42, 14, 13, 0, 5, 5, 14, 0, 6, 5, 0, 0, 7, 5, 0, 0, 8, 5, 0, 0, 9, 5, 0, 2, 13, 8, 0, 2, 14, 102, 0, 0, 15, 103, 0, 8, 16, 14, 15, 0, 15, 82, 0, 8, 17, 0, 15, 0, 15, 98, 0, 14, 18, 17, 15, 43, 15, 14, 16, 1, 18, 42, 14, 13, 1, 15, 5, 10, 14, 0, 13, 6, 0, 5, 6, 13, 0, 13, 82, 0, 8, 14, 10, 13, 22, 13, 6, 14, 40, 13, 2288, 0, 13, 93, 0, 8, 14, 0, 13, 0, 13, 98, 0, 13, 15, 6, 13, 43, 13, 0, 14, 1, 15, 0, 14, 83, 0, 19, 15, 13, 14, 0, 13, 93, 0, 8, 14, 0, 13, 0, 13, 98, 0, 13, 16, 6, 13, 0, 13, 87, 0, 11, 17, 16, 13, 43, 13, 0, 14, 1, 17, 17, 14, 15, 13, 9, 10, 6, 14, 5, 13, 6, 0, 13, 87, 0, 11, 14, 6, 13, 5, 6, 14, 39, 2189, 0, 13, 82, 0, 8, 14, 10, 13, 0, 13, 6, 0, 23, 15, 14, 13, 40, 15, 2483, 2, 13, 8, 0, 42, 14, 13, 0, 5, 9, 14, 0, 13, 6, 0, 5, 8, 13, 0, 13, 6, 0, 5, 6, 13, 0, 13, 82, 0, 8, 14, 10, 13, 22, 13, 6, 14, 40, 13, 2466, 0, 13, 84, 0, 19, 14, 8, 13, 8, 13, 10, 6, 11, 15, 14, 13, 5, 8, 15, 2, 13, 102, 0, 0, 14, 104, 0, 8, 15, 13, 14, 14, 14, 8, 4, 43, 16, 13, 15, 1, 14, 5, 7, 16, 13, 13, 7, 4, 12, 14, 8, 13, 5, 8, 14, 0, 13, 82, 0, 8, 14, 9, 13, 0, 13, 6, 0, 23, 15, 14, 13, 5, 13, 15, 41, 13, 2435, 0, 14, 6, 0, 23, 15, 7, 14, 5, 13, 15, 40, 13, 2450, 0, 13, 82, 0, 8, 14, 9, 13, 9, 9, 14, 7, 5, 13, 6, 0, 13, 87, 0, 11, 14, 6, 13, 5, 6, 14, 39, 2332, 0, 13, 82, 0, 8, 14, 5, 13, 9, 5, 14, 8, 5, 10, 9, 39, 2288, 0, 13, 7, 0, 5, 11, 13, 0, 13, 82, 0, 8, 14, 5, 13, 0, 13, 87, 0, 12, 15, 14, 13, 5, 6, 15, 0, 13, 6, 0, 25, 14, 6, 13, 40, 14, 2561, 0, 13, 94, 0, 8, 14, 1, 13, 8, 13, 5, 6, 43, 15, 1, 14, 1, 13, 11, 13, 11, 15, 5, 11, 13, 5, 13, 6, 0, 13, 87, 0, 12, 14, 6, 13, 5, 6, 14, 39, 2509, 2, 13, 102, 0, 0, 14, 103, 0, 8, 15, 13, 14, 0, 14, 82, 0, 8, 16, 0, 14, 0, 14, 83, 0, 13, 17, 16, 14, 2, 14, 102, 0, 0, 16, 105, 0, 8, 18, 14, 16, 0, 16, 82, 0, 8, 19, 1, 16, 43, 16, 14, 18, 1, 19, 2, 14, 102, 0, 0, 18, 105, 0, 8, 19, 14, 18, 0, 18, 98, 0, 43, 20, 14, 19, 1, 18, 14, 14, 16, 20, 14, 16, 17, 14, 43, 14, 13, 15, 1, 16, 5, 12, 14, 0, 13, 82, 0, 8, 14, 11, 13, 5, 6, 14, 22, 13, 6, 12, 40, 13, 2703, 0, 13, 6, 0, 8, 14, 1, 13, 11, 13, 14, 11, 5, 11, 13, 5, 13, 6, 0, 13, 87, 0, 11, 14, 6, 13, 5, 6, 14, 39, 2665, 45, 11, 0, 13, 5, 0, 45, 13, 4, 2, 0, 7, 7, 0, 5, 3, 7, 0, 7, 87, 0, 32, 8, 7, 5, 4, 8, 0, 5, 5, 0, 0, 6, 5, 0, 0, 7, 87, 0, 11, 8, 4, 7, 5, 4, 8, 0, 7, 82, 0, 8, 9, 0, 7, 22, 7, 8, 9, 40, 7, 3306, 0, 7, 93, 0, 8, 8, 0, 7, 43, 7, 0, 8, 1, 4, 5, 5, 7, 0, 7, 87, 0, 11, 8, 4, 7, 0, 7, 82, 0, 8, 9, 0, 7, 22, 7, 8, 9, 40, 7, 2831, 0, 7, 93, 0, 8, 8, 0, 7, 0, 7, 87, 0, 11, 9, 4, 7, 43, 7, 0, 8, 1, 9, 5, 8, 7, 39, 2838, 0, 7, 6, 0, 5, 8, 7, 5, 6, 8, 0, 7, 106, 0, 24, 8, 7, 5, 5, 7, 8, 40, 7, 2866, 0, 8, 107, 0, 24, 9, 5, 8, 5, 7, 9, 5, 8, 7, 40, 8, 2883, 0, 7, 108, 0, 24, 9, 7, 6, 5, 8, 9, 5, 7, 8, 40, 7, 2900, 0, 8, 109, 0, 24, 9, 6, 8, 5, 7, 9, 40, 7, 2956, 0, 7, 110, 0, 0, 8, 111, 0, 16, 9, 5, 8, 0, 8, 112, 0, 19, 10, 9, 8, 11, 8, 7, 10, 0, 7, 111, 0, 16, 9, 6, 7, 11, 7, 8, 9, 5, 5, 7, 5, 7, 4, 0, 7, 87, 0, 11, 8, 4, 7, 5, 4, 8, 0, 7, 113, 0, 24, 8, 5, 7, 40, 8, 2994, 2, 7, 114, 0, 0, 8, 115, 0, 8, 9, 7, 8, 43, 8, 7, 9, 1, 5, 11, 7, 3, 8, 5, 3, 7, 39, 3304, 0, 7, 116, 0, 24, 8, 5, 7, 40, 8, 3073, 2, 7, 114, 0, 0, 8, 115, 0, 8, 9, 7, 8, 0, 8, 117, 0, 0, 10, 99, 0, 21, 11, 5, 10, 0, 10, 118, 0, 16, 12, 11, 10, 17, 10, 8, 12, 0, 8, 119, 0, 0, 11, 101, 0, 16, 12, 5, 11, 17, 11, 8, 12, 43, 8, 7, 9, 2, 10, 11, 11, 7, 3, 8, 5, 3, 7, 39, 3304, 0, 7, 120, 0, 24, 8, 5, 7, 40, 8, 3177, 2, 7, 114, 0, 0, 8, 115, 0, 8, 9, 7, 8, 0, 8, 121, 0, 0, 10, 122, 0, 21, 11, 5, 10, 0, 10, 96, 0, 16, 12, 11, 10, 17, 10, 8, 12, 0, 8, 119, 0, 0, 11, 99, 0, 21, 12, 5, 11, 0, 11, 101, 0, 16, 13, 12, 11, 17, 11, 8, 13, 0, 8, 119, 0, 0, 12, 101, 0, 16, 13, 5, 12, 17, 12, 8, 13, 43, 8, 7, 9, 3, 10, 11, 12, 11, 7, 3, 8, 5, 3, 7, 39, 3304, 0, 7, 123, 0, 24, 8, 5, 7, 40, 8, 3304, 2, 7, 114, 0, 0, 8, 115, 0, 8, 9, 7, 8, 0, 8, 124, 0, 0, 10, 125, 0, 21, 11, 5, 10, 0, 10, 126, 0, 16, 12, 11, 10, 17, 10, 8, 12, 0, 8, 119, 0, 0, 11, 122, 0, 21, 12, 5, 11, 0, 11, 101, 0, 16, 13, 12, 11, 17, 11, 8, 13, 0, 8, 119, 0, 0, 12, 99, 0, 21, 13, 5, 12, 0, 12, 101, 0, 16, 14, 13, 12, 17, 12, 8, 14, 0, 8, 119, 0, 0, 13, 101, 0, 16, 14, 5, 13, 17, 13, 8, 14, 43, 8, 7, 9, 4, 10, 11, 12, 13, 11, 7, 3, 8, 5, 3, 7, 39, 2738, 45, 3, 0, 7, 5, 0, 45, 7, 4, 2, 0, 5, 7, 0, 5, 3, 5, 0, 5, 6, 0, 5, 4, 5, 0, 5, 82, 0, 8, 6, 0, 5, 22, 5, 4, 6, 40, 5, 3439, 2, 5, 114, 0, 0, 6, 115, 0, 8, 7, 5, 6, 0, 6, 93, 0, 8, 8, 0, 6, 43, 6, 0, 8, 1, 4, 0, 8, 127, 0, 16, 9, 6, 8, 0, 6, 93, 0, 8, 8, 0, 6, 43, 6, 0, 8, 1, 4, 0, 8, 83, 0, 21, 10, 6, 8, 0, 6, 127, 0, 16, 8, 10, 6, 43, 6, 5, 7, 2, 9, 8, 11, 5, 3, 6, 5, 3, 5, 5, 5, 4, 0, 5, 87, 0, 11, 6, 4, 5, 5, 4, 6, 39, 3330, 45, 3, 0, 5, 5, 0, 45, 5, 4, 2, 0, 5, 7, 0, 5, 3, 5, 0, 5, 6, 0, 5, 4, 5, 0, 5, 82, 0, 8, 6, 0, 5, 22, 5, 4, 6, 40, 5, 3572, 2, 5, 114, 0, 0, 6, 115, 0, 8, 7, 5, 6, 0, 6, 93, 0, 8, 8, 0, 6, 43, 6, 0, 8, 1, 4, 0, 8, 83, 0, 21, 9, 6, 8, 0, 6, 127, 0, 16, 8, 9, 6, 0, 6, 93, 0, 8, 9, 0, 6, 43, 6, 0, 9, 1, 4, 0, 9, 127, 0, 16, 10, 6, 9, 43, 6, 5, 7, 2, 8, 10, 11, 5, 3, 6, 5, 3, 5, 5, 5, 4, 0, 5, 87, 0, 11, 6, 4, 5, 5, 4, 6, 39, 3463, 45, 3, 0, 5, 5, 0, 45, 5, 4, 2, 2, 5, 8, 0, 0, 6, 82, 0, 8, 7, 0, 6, 0, 6, 98, 0, 20, 8, 7, 6, 42, 6, 5, 1, 8, 5, 3, 6, 0, 5, 6, 0, 5, 4, 5, 0, 5, 82, 0, 8, 6, 3, 5, 22, 5, 4, 6, 40, 5, 3656, 0, 5, 6, 0, 9, 3, 4, 5, 5, 5, 4, 0, 5, 87, 0, 11, 6, 4, 5, 5, 4, 6, 39, 3617, 0, 5, 6, 0, 5, 4, 5, 0, 5, 82, 0, 8, 6, 0, 5, 0, 5, 83, 0, 13, 7, 6, 5, 22, 5, 4, 7, 40, 5, 3769, 0, 5, 128, 0, 20, 6, 4, 5, 8, 5, 3, 6, 0, 7, 93, 0, 8, 8, 0, 7, 0, 7, 83, 0, 14, 9, 4, 7, 43, 7, 0, 8, 1, 9, 0, 8, 127, 0, 16, 9, 7, 8, 0, 7, 129, 0, 0, 8, 130, 0, 15, 10, 4, 8, 12, 8, 7, 10, 19, 7, 9, 8, 17, 8, 5, 7, 9, 3, 6, 8, 0, 5, 83, 0, 11, 6, 4, 5, 5, 4, 6, 39, 3663, 45, 3, 0, 5, 5, 0, 45, 5, 4, 2, 0, 5, 7, 0, 5, 3, 5, 0, 5, 6, 0, 5, 4, 5, 0, 5, 82, 0, 8, 6, 0, 5, 0, 5, 130, 0, 13, 7, 6, 5, 22, 5, 4, 7, 40, 5, 3894, 2, 5, 114, 0, 0, 6, 115, 0, 8, 7, 5, 6, 0, 6, 128, 0, 20, 8, 4, 6, 8, 6, 0, 8, 0, 8, 129, 0, 0, 9, 130, 0, 15, 10, 4, 9, 12, 9, 8, 10, 21, 8, 6, 9, 0, 6, 127, 0, 16, 9, 8, 6, 43, 6, 5, 7, 1, 9, 11, 5, 3, 6, 5, 3, 5, 0, 5, 83, 0, 11, 6, 4, 5, 5, 4, 6, 39, 3793, 45, 3, 0, 5, 5, 0, 45, 5, 4, 3, 21, 4, 0, 1, 0, 5, 130, 0, 12, 6, 5, 1, 19, 5, 0, 6, 17, 6, 4, 5, 45, 6, 0, 4, 5, 0, 45, 4, 4, 3, 21, 4, 0, 1, 45, 4, 0, 4, 5, 0, 45, 4, 4, 4, 16, 5, 0, 1, 35, 6, 0, 16, 7, 6, 2, 18, 6, 5, 7, 45, 6, 0, 5, 5, 0, 45, 5, 4, 4, 16, 5, 0, 1, 16, 6, 0, 2, 18, 7, 5, 6, 16, 5, 1, 2, 18, 6, 7, 5, 45, 6, 0, 5, 5, 0, 45, 5, 4, 2, 3, 3, 0, 0, 4, 98, 0, 42, 5, 3, 2, 0, 4, 3, 3, 0, 0, 4, 131, 0, 42, 6, 3, 2, 0, 4, 18, 3, 5, 6, 3, 4, 0, 0, 5, 132, 0, 42, 6, 4, 2, 0, 5, 18, 4, 3, 6, 45, 4, 0, 3, 5, 0, 45, 3, 4, 2, 3, 3, 0, 0, 4, 99, 0, 42, 5, 3, 2, 0, 4, 3, 3, 0, 0, 4, 133, 0, 42, 6, 3, 2, 0, 4, 18, 3, 5, 6, 3, 4, 0, 0, 5, 134, 0, 42, 6, 4, 2, 0, 5, 18, 4, 3, 6, 45, 4, 0, 3, 5, 0, 45, 3, 4, 2, 3, 3, 0, 0, 4, 126, 0, 42, 5, 3, 2, 0, 4, 3, 3, 0, 0, 4, 125, 0, 42, 6, 3, 2, 0, 4, 18, 3, 5, 6, 3, 4, 1, 0, 5, 100, 0, 42, 6, 4, 2, 0, 5, 18, 4, 3, 6, 45, 4, 0, 3, 5, 0, 45, 3, 4, 2, 3, 3, 0, 0, 4, 135, 0, 42, 5, 3, 2, 0, 4, 3, 3, 0, 0, 4, 136, 0, 42, 6, 3, 2, 0, 4, 18, 3, 5, 6, 3, 4, 1, 0, 5, 112, 0, 42, 6, 4, 2, 0, 5, 18, 4, 3, 6, 45, 4, 0, 3, 5, 0, 45, 3, 4, 2, 3, 3, 0, 0, 4, 137, 0, 42, 5, 3, 2, 0, 4, 3, 3, 0, 0, 4, 138, 0, 42, 6, 3, 2, 0, 4, 18, 3, 5, 6, 3, 4, 0, 0, 5, 139, 0, 42, 6, 4, 2, 0, 5, 18, 4, 3, 6, 45, 4, 0, 3, 5, 0, 45, 3, 4, 2, 3, 3, 0, 0, 4, 140, 0, 42, 5, 3, 2, 0, 4, 3, 3, 0, 0, 4, 125, 0, 42, 6, 3, 2, 0, 4, 18, 3, 5, 6, 3, 4, 0, 0, 5, 141, 0, 42, 6, 4, 2, 0, 5, 18, 4, 3, 6, 45, 4, 0, 3, 5, 0, 45, 3, 4, 2, 3, 3, 0, 0, 4, 87, 0, 42, 5, 3, 2, 0, 4, 3, 3, 0, 0, 4, 83, 0, 42, 6, 3, 2, 0, 4, 18, 3, 5, 6, 3, 4, 1, 0, 5, 126, 0, 42, 6, 4, 2, 0, 5, 18, 4, 3, 6, 45, 4, 0, 3, 5, 0, 45, 3, 4, 2, 3, 3, 0, 0, 4, 136, 0, 42, 5, 3, 2, 0, 4, 3, 3, 0, 0, 4, 142, 0, 42, 6, 3, 2, 0, 4, 18, 3, 5, 6, 3, 4, 1, 0, 5, 99, 0, 42, 6, 4, 2, 0, 5, 18, 4, 3, 6, 45, 4, 0, 3, 5, 0, 45, 3, 4, 3, 2, 18, 8, 0, 0, 19, 143, 0, 0, 20, 144, 0, 32, 21, 20, 0, 20, 145, 0, 0, 22, 146, 0, 32, 23, 22, 0, 22, 147, 0, 0, 24, 148, 0, 32, 25, 24, 0, 24, 149, 0, 0, 26, 150, 0, 44, 27, 18, 8, 19, 21, 20, 23, 22, 25, 24, 26, 5, 4, 27, 2, 18, 8, 0, 0, 19, 151, 0, 44, 20, 18, 1, 19, 5, 5, 20, 0, 6, 5, 0, 0, 7, 5, 0, 0, 8, 5, 0, 0, 9, 5, 0, 0, 10, 5, 0, 0, 11, 5, 0, 0, 12, 5, 0, 0, 13, 5, 0, 0, 14, 5, 0, 0, 15, 5, 0, 0, 16, 5, 0, 0, 17, 5, 0, 0, 18, 128, 0, 20, 19, 1, 18, 8, 18, 0, 19, 0, 20, 119, 0, 0, 21, 129, 0, 0, 22, 130, 0, 15, 23, 1, 22, 12, 22, 21, 23, 19, 21, 20, 22, 17, 20, 18, 21, 9, 0, 19, 20, 0, 18, 151, 0, 11, 19, 1, 18, 0, 18, 152, 0, 20, 20, 19, 18, 0, 18, 95, 0, 19, 19, 20, 18, 0, 18, 96, 0, 11, 20, 19, 18, 9, 0, 20, 1, 0, 18, 6, 0, 5, 14, 18, 0, 18, 82, 0, 8, 19, 0, 18, 22, 18, 14, 19, 40, 18, 5280, 0, 18, 6, 0, 8, 19, 4, 18, 5, 6, 19, 0, 18, 87, 0, 8, 19, 4, 18, 5, 7, 19, 0, 18, 98, 0, 8, 19, 4, 18, 5, 8, 19, 0, 18, 100, 0, 8, 19, 4, 18, 5, 9, 19, 0, 18, 95, 0, 8, 19, 4, 18, 5, 10, 19, 0, 18, 128, 0, 8, 19, 4, 18, 5, 11, 19, 0, 18, 99, 0, 8, 19, 4, 18, 5, 12, 19, 0, 18, 126, 0, 8, 19, 4, 18, 5, 13, 19, 0, 18, 6, 0, 5, 15, 18, 0, 18, 151, 0, 22, 19, 15, 18, 40, 19, 5067, 0, 18, 84, 0, 22, 19, 15, 18, 40, 19, 4816, 11, 18, 15, 14, 8, 19, 0, 18, 9, 5, 15, 19, 39, 4911, 3, 18, 0, 3, 19, 0, 3, 20, 0, 3, 21, 1, 0, 22, 98, 0, 12, 23, 15, 22, 8, 22, 5, 23, 42, 23, 21, 1, 22, 0, 21, 126, 0, 12, 22, 15, 21, 8, 21, 5, 22, 42, 22, 20, 2, 23, 21, 3, 20, 2, 0, 21, 96, 0, 12, 23, 15, 21, 8, 21, 5, 23, 42, 23, 20, 1, 21, 42, 20, 19, 2, 22, 23, 0, 19, 84, 0, 12, 21, 15, 19, 8, 19, 5, 21, 42, 21, 18, 2, 20, 19, 9, 5, 15, 21, 3, 18, 0, 3, 19, 0, 3, 20, 0, 3, 21, 0, 3, 22, 3, 42, 23, 22, 1, 10, 42, 22, 21, 2, 13, 23, 3, 21, 4, 42, 23, 21, 3, 10, 11, 12, 42, 21, 20, 2, 22, 23, 3, 20, 5, 8, 22, 20, 15, 42, 20, 19, 2, 21, 22, 8, 19, 5, 15, 42, 21, 18, 2, 20, 19, 5, 16, 21, 3, 18, 0, 3, 19, 6, 42, 20, 19, 1, 6, 3, 19, 7, 42, 21, 19, 3, 6, 7, 8, 42, 19, 18, 2, 20, 21, 5, 17, 19, 5, 13, 12, 5, 12, 11, 5, 11, 10, 3, 18, 0, 42, 19, 18, 2, 9, 16, 5, 10, 19, 5, 9, 8, 5, 8, 7, 5, 7, 6, 3, 18, 0, 42, 19, 18, 2, 16, 17, 5, 6, 19, 5, 18, 15, 0, 18, 87, 0, 11, 19, 15, 18, 5, 15, 19, 39, 4780, 0, 18, 6, 0, 3, 19, 0, 0, 20, 6, 0, 8, 21, 4, 20, 42, 20, 19, 2, 6, 21, 9, 4, 18, 20, 0, 18, 87, 0, 3, 19, 0, 0, 20, 87, 0, 8, 21, 4, 20, 42, 20, 19, 2, 7, 21, 9, 4, 18, 20, 0, 18, 98, 0, 3, 19, 0, 0, 20, 98, 0, 8, 21, 4, 20, 42, 20, 19, 2, 8, 21, 9, 4, 18, 20, 0, 18, 100, 0, 3, 19, 0, 0, 20, 100, 0, 8, 21, 4, 20, 42, 20, 19, 2, 9, 21, 9, 4, 18, 20, 0, 18, 95, 0, 3, 19, 0, 0, 20, 95, 0, 8, 21, 4, 20, 42, 20, 19, 2, 10, 21, 9, 4, 18, 20, 0, 18, 128, 0, 3, 19, 0, 0, 20, 128, 0, 8, 21, 4, 20, 42, 20, 19, 2, 11, 21, 9, 4, 18, 20, 0, 18, 99, 0, 3, 19, 0, 0, 20, 99, 0, 8, 21, 4, 20, 42, 20, 19, 2, 12, 21, 9, 4, 18, 20, 0, 18, 126, 0, 3, 19, 0, 0, 20, 126, 0, 8, 21, 4, 20, 42, 20, 19, 2, 13, 21, 9, 4, 18, 20, 0, 18, 84, 0, 11, 19, 14, 18, 5, 14, 19, 39, 4670, 45, 4, 0, 18, 5, 0, 45, 18, 4, 3, 0, 6, 120, 0, 16, 7, 0, 6, 0, 6, 120, 0, 16, 8, 1, 6, 11, 6, 7, 8, 5, 4, 6, 0, 6, 84, 0, 20, 7, 0, 6, 0, 6, 84, 0, 20, 8, 1, 6, 11, 6, 7, 8, 0, 7, 84, 0, 20, 8, 4, 7, 11, 7, 6, 8, 5, 5, 7, 0, 6, 84, 0, 19, 7, 5, 6, 0, 6, 120, 0, 16, 8, 4, 6, 17, 6, 7, 8, 45, 6, 0, 6, 5, 0, 45, 6];
var MAIN_START_PC = 0;
var MAIN_REG_COUNT = 6;
var ENCODE_BYTECODE = false;
var TIMING_CHECKS = false;
var OP = {
  LOAD_CONST: 0,
  LOAD_INT: 1,
  LOAD_GLOBAL: 2,
  LOAD_UPVALUE: 3,
  LOAD_THIS: 4,
  MOVE: 5,
  STORE_GLOBAL: 6,
  STORE_UPVALUE: 7,
  GET_PROP: 8,
  SET_PROP: 9,
  DELETE_PROP: 10,
  ADD: 11,
  SUB: 12,
  MUL: 13,
  DIV: 14,
  MOD: 15,
  EXP: 60,
  BAND: 16,
  BOR: 17,
  BXOR: 18,
  SHL: 19,
  SHR: 20,
  USHR: 21,
  LT: 22,
  GT: 23,
  LTE: 24,
  GTE: 25,
  EQ: 26,
  NEQ: 27,
  LOOSE_EQ: 28,
  LOOSE_NEQ: 29,
  IN: 30,
  INSTANCEOF: 31,
  UNARY_NEG: 32,
  UNARY_POS: 33,
  UNARY_NOT: 34,
  UNARY_BITNOT: 35,
  TYPEOF: 36,
  VOID: 37,
  TYPEOF_SAFE: 38,
  JUMP: 39,
  JUMP_IF_FALSE: 40,
  JUMP_IF_TRUE: 41,
  CALL: 42,
  CALL_METHOD: 43,
  NEW: 44,
  RETURN: 45,
  THROW: 46,
  MAKE_CLOSURE: 47,
  BUILD_ARRAY: 48,
  BUILD_OBJECT: 49,
  DEFINE_GETTER: 50,
  DEFINE_SETTER: 51,
  FOR_IN_SETUP: 52,
  FOR_IN_NEXT: 53,
  TRY_SETUP: 54,
  TRY_END: 55,
  PATCH: 56,
  DEBUGGER: 57,
  JUMP_REG: 58,
  FINALLY_SETUP: 59
};
var SENTINELS = {
  CALL_SPREAD: 65535
};
var SLOTS = {
  PC: 0,
  CALLER: 1,
  RET_DST: 2,
  THIS: 3,
  CLOSURE: 4,
  HANDLERS: 5,
  FRAME_SIZE: 6,
  REG_BASE: 7
};
var HEADER_SIZE = 8;
var FRAME_START = 1;
function base64ToBytes(s) {
  return typeof Buffer !== "undefined" ? Buffer.from(s, "base64") : Uint8Array.from(atob(s), function (c) {
    return c.charCodeAt(0);
  });
}
function decodeBytecode(s) {
  if (!ENCODE_BYTECODE) return s;
  var b = base64ToBytes(s);
  // Each slot is a u32 stored as 4 little-endian bytes.
  var r = new Uint32Array(b.length / 4);
  for (var i = 0; i < r.length; i++) r[i] = (b[i * 4] | b[i * 4 + 1] << 8 | b[i * 4 + 2] << 16 | b[i * 4 + 3] << 24) >>> 0;
  return r;
}

// Closure map
// Maps shell functions -> inner Closure so the VM can fast-path instead of going through a sub-VM on internal calls.
// A WeakMap is used over a Symbol to prevent leaking information to debuggers
var CLOSURE_MAP = new WeakMap();

// Upvalue (Lua style)
// While the outer frame is alive: reads/writes go to vm._regs[_absSlot].
// After the outer frame returns (closed): reads/writes hit this._value.
// (_absSlot is an absolute index into the flat slot array, so it stays valid
// no matter where the owning frame's block sits.)
function Upvalue(regs, absSlot) {
  this._regs = regs; // shared reference to VM._regs flat array
  this._absSlot = absSlot; // absolute index; stable as long as frame is alive
  this._closed = false;
  this._value = undefined;
}
Upvalue.prototype._read = function () {
  return this._closed ? this._value : this._regs[this._absSlot];
};
Upvalue.prototype._write = function (v) {
  if (this._closed) this._value = v;else this._regs[this._absSlot] = v;
};
Upvalue.prototype._close = function () {
  this._value = this._regs[this._absSlot];
  this._closed = true;
};

// Closure & Frame
function Closure(fn) {
  this.fn = fn;
  this.upvalues = [];
  this.prototype = {}; // <- default prototype object for `new`
}

// VM
// There is no Frame object and no frame stack. A frame is a block of slots in
// the flat array `_regs`: HEADER_SIZE header slots (see utils/frame-layout.ts) followed
// by the frame's registers. `_f` — the only piece of live execution state the VM
// object exposes — is the current frame's base offset, and each frame's CALLER
// slot points at the one that called it, so the call stack is an implicit linked
// list with nothing to enumerate.
function VM(bytecode, constants, globals) {
  this.bytecode = bytecode;
  this.constants = constants;
  this.globals = globals;
  // Open upvalues, keyed by absolute slot; created on the first capture so a
  // closure-free program never allocates it. See captureUpvalue().
  this._openUpvalues = null;

  // Flat slot array (Lua-style register file, with the frame headers folded in).
  // _regsTop is the next free slot (= base of the hypothetical next frame).
  // On CALL:   newBase = _regsTop; _regsTop += HEADER_SIZE + fn.regCount
  // On RETURN: _regsTop = <returning frame's base>   (pop the whole block)
  // Slot 0 is never part of a frame: it holds the value run() hands back, and
  // doubles as the "no frame" sentinel for _f / CALLER.
  this._regs = [];
  this._regsTop = FRAME_START;
  this._f = 0;
}

// Consume the next slot from the flat bytecode stream and advance the PC.
// Called by opcode handlers to read each of their operands in order.
// The PC is a header slot, so no object anywhere holds a property containing it.
VM.prototype._operand = function () {
  return this.bytecode[this._regs[this._f + SLOTS.PC]++];
};

// Push a new frame block on top of the slot array and make it current.
// retDst encodes the caller's destination register as (reg << 1), with bit 0 set
// for a constructor call (`new`) — RETURN uses it to decide whether to hand back
// the THIS slot instead of the returned value.
// args === null skips parameter setup (used for the root frame).
VM.prototype._pushFrame = function (closure, args, thisVal, retDst) {
  var fn = closure.fn;
  var regs = this._regs;
  var fp = this._regsTop;
  var size = HEADER_SIZE + fn.regCount;
  var end = fp + size;
  while (regs.length < end) regs.push(undefined);
  for (var i = fp; i < end; i++) regs[i] = undefined;
  var base = fp + HEADER_SIZE;
  regs[fp + SLOTS.PC] = fn.startPc;
  regs[fp + SLOTS.CALLER] = this._f;
  regs[fp + SLOTS.RET_DST] = retDst;
  regs[fp + SLOTS.THIS] = thisVal;
  regs[fp + SLOTS.CLOSURE] = closure;
  regs[fp + SLOTS.FRAME_SIZE] = size;
  regs[fp + SLOTS.REG_BASE] = base;

  // Seeds for the decoy header slots this build happens to have (see utils/frame-layout.ts)
  /* @NOISE */
  if (typeof SLOTS.NOISE_END === "number") regs[fp + SLOTS.NOISE_END] = end;
  if (typeof SLOTS.NOISE_PARAMS === "number") regs[fp + SLOTS.NOISE_PARAMS] = fn.paramCount;
  if (typeof SLOTS.NOISE_ARGS === "number") regs[fp + SLOTS.NOISE_ARGS] = args;
  if (typeof SLOTS.NOISE_PC === "number") regs[fp + SLOTS.NOISE_PC] = fn.startPc;
  if (typeof SLOTS.NOISE_COUNTER === "number") regs[fp + SLOTS.NOISE_COUNTER] = 0;
  this._regsTop = end;
  if (args) {
    if (fn.hasRest) {
      var restSlot = fn.paramCount - 1;
      for (var p = 0; p < restSlot; p++) regs[base + p] = p < args.length ? args[p] : undefined;
      regs[base + restSlot] = args.slice(restSlot);
    } else {
      for (var a = 0; a < args.length && a < fn.regCount; a++) regs[base + a] = args[a];
    }
    if (fn.paramCount < fn.regCount) regs[base + fn.paramCount] = args;
  }
  this._f = fp;
};
VM.prototype.captureUpvalue = function (fp, slot) {
  // Dedup by absolute slot — two closures capturing the same local share one
  // Upvalue. _openUpvalues is keyed BY absolute slot rather than being a list of
  // live captures, so this is a direct lookup instead of a scan, and closing a
  // frame's captures costs a walk of that frame's own window (below) instead of
  // a filter over every capture in the program. Entries are removed on close, so
  // anything found here is open by construction.
  var absSlot = this._regs[fp + SLOTS.REG_BASE] + slot;
  var uvs = this._openUpvalues || (this._openUpvalues = []);
  return uvs[absSlot] || (uvs[absSlot] = new Upvalue(this._regs, absSlot));
};

// Reads and decodes a constant from the pool.
// idx: pool index (first operand of the constant pair emitted by resolveConstants).
// key: conceal key (second operand). 0 means no concealment.
//
// For integers:  stored value is (original ^ key) with the full u32 key; XOR
//                again to recover (JS `^` is int32, so this is symmetric).
// For strings:   stored value is a base64 string containing u16 LE byte pairs.
//                Mirrors decodeBytecode: base64 → bytes → u16 LE → XOR with a
//                position-based Weyl keystream seeded by the full u32 key.
// idxIn, keyIn are passed in from specializedOpcodes when the operands are determined at compile time.
VM.prototype._constant = function (idxIn, keyIn) {
  var idx = idxIn ?? this._operand();
  var key = keyIn ?? this._operand();
  var v = this.constants[idx];
  if (!key) return v;
  if (typeof v === "number") return v ^ key;
  if (typeof v !== "string") return v;

  // String: base64-decode to u16 LE byte pairs, then XOR each code with a
  // 16-bit keystream word derived from the full 32-bit key + position.
  var b = base64ToBytes(v);
  var out = "";
  var k = key;
  for (var i = 0; i < b.length / 2; i++) {
    k = k + 0x9e3779b9 | 0; // 32-bit Weyl step (position-based)
    var ks = (k ^ k >>> 13) & 0xffff; // 16-bit keystream word
    var code = b[i * 2] | b[i * 2 + 1] << 8; // u16 LE
    out += String.fromCharCode(code ^ ks);
  }
  return out;
};
VM.prototype._closeUpvaluesFor = function (fp) {
  // Called on RETURN — close every upvalue captured from this frame's register
  // window [REG_BASE, end of the frame block) and free its table entry, so a
  // later frame reusing those slots starts with no captures.
  var uvs = this._openUpvalues;
  if (!uvs) return; // nothing in this program ever captured a local
  var regs = this._regs;
  var hi = fp + regs[fp + SLOTS.FRAME_SIZE];
  for (var i = regs[fp + SLOTS.REG_BASE]; i < hi; i++) {
    var uv = uvs[i];
    if (uv) {
      uv._close();
      uvs[i] = undefined;
    }
  }
};

// Executes `closure` to completion and returns its return value.
// The root frame's CALLER slot is 0 (the sentinel), so its RETURN parks the
// value in slot 0 and clears _f, which stops the loop below.
VM.prototype.run = function (closure, thisVal, args) {
  var now = () => {
    return performance.now();
  };
  var lastTime = now();
  this._pushFrame(closure, args, thisVal, 0);
  while (true) {
    var fp = this._f;
    var regs = this._regs;
    var bc = this.bytecode;
    var pc = regs[fp + SLOTS.PC];
    if (pc >= bc.length) break;
    regs[fp + SLOTS.PC] = pc + 1;
    var op = this.bytecode[pc];
    // var opcode = this.bytecode[pc];
    // console.log(`[run] pc=${pc}, opcode=${opcode}, name=${Object.keys(OP).find((key) => OP[key] === opcode)}`);

    // Churn the decoy header slots so the real PC isn't the only slot moving
    /* @NOISE */
    if (typeof SLOTS.NOISE_PC === "number") regs[fp + SLOTS.NOISE_PC] = (regs[fp + SLOTS.NOISE_PC] + 1) % bc.length;
    if (typeof SLOTS.NOISE_COUNTER === "number") regs[fp + SLOTS.NOISE_COUNTER]++;
    if (typeof SLOTS.NOISE_MIRROR === "number") regs[fp + SLOTS.NOISE_MIRROR] = op;
    if (typeof SLOTS.NOISE_ACC === "number") regs[fp + SLOTS.NOISE_ACC] = regs[fp + SLOTS.NOISE_ACC] ^ pc | 0;

    // Debugging protection: Detects debugger by checking for >1s pauses which can only happen from debugger; or extremely slow sync tasks
    if (TIMING_CHECKS) {
      var currentTime = now();
      var isTamper = currentTime - lastTime > TIMING_CHECKS;
      lastTime = currentTime;
      if (isTamper) {
        // Poison the bytecode
        for (var i = 0; i < this.bytecode.length; i++) this.bytecode[i] = 0;
        // Break the current state
        for (var i2 = fp; i2 < this._regsTop; i2++) this._regs[i2] = undefined;
        op = OP.JUMP;
        regs[fp + SLOTS.PC] = this.bytecode.length; // jump past end to halt
      }
    }
    try {
      var base = regs[fp + SLOTS.REG_BASE];

      /* @SWITCH */
      switch (op) {
        case OP.LOAD_CONST:
          {
            var dst = this._operand();
            regs[base + dst] = this._constant();
            break;
          }
        case OP.LOAD_INT:
          {
            var dst = this._operand();
            regs[base + dst] = this._operand();
            break;
          }
        case OP.LOAD_GLOBAL:
          {
            var dst = this._operand();
            var globalName = this._constant();
            if (!(globalName in this.globals)) {
              throw new ReferenceError(`${globalName} is not defined`);
            }
            regs[base + dst] = this.globals[globalName];
            break;
          }
        case OP.LOAD_UPVALUE:
          {
            var dst = this._operand();
            regs[base + dst] = regs[fp + SLOTS.CLOSURE].upvalues[this._operand()]._read();
            break;
          }
        case OP.LOAD_THIS:
          {
            var dst = this._operand();
            regs[base + dst] = regs[fp + SLOTS.THIS];
            break;
          }
        case OP.MOVE:
          {
            var dst = this._operand();
            regs[base + dst] = regs[base + this._operand()];
            break;
          }
        case OP.STORE_GLOBAL:
          {
            // globals[globalName] = regs[src]
            this.globals[this._constant()] = regs[base + this._operand()];
            break;
          }
        case OP.STORE_UPVALUE:
          {
            var uvIdx = this._operand();
            regs[fp + SLOTS.CLOSURE].upvalues[uvIdx]._write(regs[base + this._operand()]);
            break;
          }
        case OP.GET_PROP:
          {
            // dst = regs[obj][regs[key]]
            var dst = this._operand();
            var obj = regs[base + this._operand()];
            var key = regs[base + this._operand()];
            regs[base + dst] = obj[key];
            break;
          }
        case OP.SET_PROP:
          {
            // regs[obj][regs[key]] = regs[val]
            var obj = regs[base + this._operand()];
            var key = regs[base + this._operand()];
            var val = regs[base + this._operand()];
            // Reflect.set performs [[Set]] without throwing on failure (non-strict mode behavior)
            Reflect.set(obj, key, val);
            break;
          }
        case OP.DELETE_PROP:
          {
            // regs[dst] = delete regs[obj][regs[key]]
            // The delete operator returns true if successful which is most cases
            var dst = this._operand();
            var obj = regs[base + this._operand()];
            var key = regs[base + this._operand()];
            regs[base + dst] = delete obj[key];
            break;
          }

        // Arithmetic  (dst, src1, src2)
        case OP.ADD:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a + regs[base + this._operand()];
            break;
          }
        case OP.SUB:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a - regs[base + this._operand()];
            break;
          }
        case OP.MUL:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a * regs[base + this._operand()];
            break;
          }
        case OP.DIV:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a / regs[base + this._operand()];
            break;
          }
        case OP.MOD:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a % regs[base + this._operand()];
            break;
          }
        case OP.EXP:
          {
            // Math.pow instead of `**`
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = Math.pow(a, regs[base + this._operand()]);
            break;
          }
        case OP.BAND:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a & regs[base + this._operand()];
            break;
          }
        case OP.BOR:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a | regs[base + this._operand()];
            break;
          }
        case OP.BXOR:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a ^ regs[base + this._operand()];
            break;
          }
        case OP.SHL:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a << regs[base + this._operand()];
            break;
          }
        case OP.SHR:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a >> regs[base + this._operand()];
            break;
          }
        case OP.USHR:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a >>> regs[base + this._operand()];
            break;
          }

        // Comparison  (dst, src1, src2)
        case OP.LT:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a < regs[base + this._operand()];
            break;
          }
        case OP.GT:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a > regs[base + this._operand()];
            break;
          }
        case OP.LTE:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a <= regs[base + this._operand()];
            break;
          }
        case OP.GTE:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a >= regs[base + this._operand()];
            break;
          }
        case OP.EQ:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a === regs[base + this._operand()];
            break;
          }
        case OP.NEQ:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a !== regs[base + this._operand()];
            break;
          }
        case OP.LOOSE_EQ:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a == regs[base + this._operand()];
            break;
          }
        case OP.LOOSE_NEQ:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a != regs[base + this._operand()];
            break;
          }
        case OP.IN:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a in regs[base + this._operand()];
            break;
          }
        case OP.INSTANCEOF:
          {
            // regs[dst] = regs[obj] instanceof regs[ctor]
            // Since VM closures are wrapped in native function shells (MAKE_CLOSURE), the native operator works
            var dst = this._operand();
            var obj = regs[base + this._operand()];
            regs[base + dst] = obj instanceof regs[base + this._operand()];
            break;
          }

        // Unary  (dst, src)
        case OP.UNARY_NEG:
          {
            var dst = this._operand();
            regs[base + dst] = -regs[base + this._operand()];
            break;
          }
        case OP.UNARY_POS:
          {
            var dst = this._operand();
            regs[base + dst] = +regs[base + this._operand()];
            break;
          }
        case OP.UNARY_NOT:
          {
            var dst = this._operand();
            regs[base + dst] = !regs[base + this._operand()];
            break;
          }
        case OP.UNARY_BITNOT:
          {
            var dst = this._operand();
            regs[base + dst] = ~regs[base + this._operand()];
            break;
          }
        case OP.TYPEOF:
          {
            var dst = this._operand();
            regs[base + dst] = typeof regs[base + this._operand()];
            break;
          }
        case OP.VOID:
          {
            var dst = this._operand();
            this._operand(); // consumes argument (intended)
            regs[base + dst] = undefined;
            break;
          }
        case OP.TYPEOF_SAFE:
          {
            // regs[dst] = typeof window[name]
            // Never throws ReferenceError, instead returns undefined for undeclared variables
            var dst = this._operand();
            var name = this._constant();
            var val = Object.prototype.hasOwnProperty.call(this.globals, name) ? this.globals[name] : undefined;
            regs[base + dst] = typeof val;
            break;
          }

        // Control flow
        case OP.JUMP:
          regs[fp + SLOTS.PC] = this._operand();
          break;
        case OP.JUMP_IF_FALSE:
          {
            var src = this._operand();
            var target = this._operand();
            if (!regs[base + src]) regs[fp + SLOTS.PC] = target;
            break;
          }
        case OP.JUMP_IF_TRUE:
          {
            // || short-circuit: if truthy, jump over RHS.
            var src = this._operand();
            var target = this._operand();
            if (regs[base + src]) regs[fp + SLOTS.PC] = target;
            break;
          }

        // Calls
        case OP.CALL:
          {
            // dst, calleeReg, argc, [argReg...]  (argc=-1 means next operand is spread-args array reg)
            var dst = this._operand();
            var callee = regs[base + this._operand()];
            var argc = this._operand();
            var args;
            if (argc === SENTINELS.CALL_SPREAD) {
              args = regs[base + this._operand()];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this._operand()];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              this._pushFrame(closure, args, this.globals, dst << 1);
            } else {
              regs[base + dst] = callee.apply(null, args);
            }
            break;
          }
        case OP.CALL_METHOD:
          {
            // dst, receiverReg, calleeReg, argc, [argReg...]  (argc=SENTINELS.CALL_SPREAD means spread-args array reg)
            var dst = this._operand();
            var receiver = regs[base + this._operand()];
            var callee = regs[base + this._operand()];
            var argc = this._operand();
            var args;
            if (argc === SENTINELS.CALL_SPREAD) {
              args = regs[base + this._operand()];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this._operand()];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              this._pushFrame(closure, args, receiver, dst << 1);
            } else {
              regs[base + dst] = callee.apply(receiver, args);
            }
            break;
          }
        case OP.NEW:
          {
            // dst, calleeReg, argc, [argReg...]  (argc=SENTINELS.CALL_SPREAD means spread-args array reg)
            var dst = this._operand();
            var callee = regs[base + this._operand()];
            var argc = this._operand();
            var args;
            if (argc === SENTINELS.CALL_SPREAD) {
              args = regs[base + this._operand()];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this._operand()];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              // The new object doubles as the frame's THIS; bit 0 of RET_DST marks
              // the frame as a constructor call so RETURN can fall back to it.
              this._pushFrame(closure, args, Object.create(closure.prototype || null), dst << 1 | 1);
            } else {
              // Reflect.construct is required - Object.create+apply does NOT set
              // internal slots ([[NumberData]], [[StringData]], etc.) for built-ins.
              regs[base + dst] = Reflect.construct(callee, args);
            }
            break;
          }
        case OP.RETURN:
          {
            var retVal = regs[base + this._operand()];
            this._closeUpvaluesFor(fp); // must happen before frame is abandoned

            var caller = regs[fp + SLOTS.CALLER];
            var retDst = regs[fp + SLOTS.RET_DST];

            // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
            if (retDst & 1 && (typeof retVal !== "object" || retVal === null)) retVal = regs[fp + SLOTS.THIS];

            // Zero out the callee's whole block (header included) to limit
            // exposing runtime values, then hand the slots back.
            var hi = fp + regs[fp + SLOTS.FRAME_SIZE];
            for (var i = fp; i < hi; i++) regs[i] = undefined;
            this._regsTop = fp;
            this._f = caller;

            // A caller of 0 is the root frame returning to the host: park the
            // value in slot 0 for run() to hand back. A bare `return retVal`
            // would only exit an extracted VM.prototype[op] handler function
            // (handlerTable option), not the loop. Keeping the sole `break`
            // trailing (no mid-body break/return) also lets the handlerTable
            // transform lift this body verbatim.
            regs[caller ? regs[caller + SLOTS.REG_BASE] + (retDst >> 1) : 0] = retVal;
            break;
          }
        case OP.THROW:
          throw regs[base + this._operand()];

        // Closures
        case OP.MAKE_CLOSURE:
          {
            // dst, startPc, paramCount, regCount, uvCount, hasRest, [isLocal, idx, ...]
            var dst = this._operand();
            var startPc = this._operand();
            var paramCount = this._operand();
            var regCount = this._operand();
            var uvCount = this._operand();
            var hasRest = this._operand(); // 1 if last param is a rest element

            var uvDescs = new Array(uvCount);
            for (var i = 0; i < uvCount; i++) {
              var isLocalRaw = this._operand();
              var uvIndex = this._operand();
              uvDescs[i] = {
                isLocal: isLocalRaw,
                _index: uvIndex
              };
            }

            // uvDescs is consumed by the capture loop below and then dropped — it
            // is deliberately NOT kept on the descriptor. A closure that carries
            // its capture plan around spells out the closure graph ("captures
            // local 2 of the parent frame") to anything that gets hold of it.
            var fn = {
              paramCount: paramCount,
              regCount: regCount,
              startPc: startPc,
              hasRest: hasRest
            };
            var closure = new Closure(fn);
            for (var i = 0; i < uvDescs.length; i++) {
              var uvd = uvDescs[i];
              if (uvd.isLocal) {
                closure.upvalues.push(this.captureUpvalue(fp, uvd._index));
              } else {
                closure.upvalues.push(regs[fp + SLOTS.CLOSURE].upvalues[uvd._index]);
              }
            }

            // Wrap in a native callable shell so host code (array methods,
            // test assertions, setTimeout, etc.) can invoke VM closures.
            // CLOSURE_MAP lets VM-internal CALL/NEW bypass the sub-VM entirely.
            var self = this;
            var shell = function (c) {
              return function () {
                return new VM(self.bytecode, self.constants, self.globals).run(c, this == null ? self.globals : this, Array.prototype.slice.call(arguments));
              };
            }(closure);
            CLOSURE_MAP.set(shell, closure);
            shell.prototype = closure.prototype; // unified prototype for new/instanceof
            regs[base + dst] = shell;
            break;
          }

        // Collections
        case OP.BUILD_ARRAY:
          {
            // dst, count, [elemReg...]
            var dst = this._operand();
            var count = this._operand();
            var elems = new Array(count);
            for (var i = 0; i < count; i++) elems[i] = regs[base + this._operand()];
            regs[base + dst] = elems;
            break;
          }
        case OP.BUILD_OBJECT:
          {
            // dst, pairCount, [keyReg, valReg, ...]
            var dst = this._operand();
            var pairCount = this._operand();
            var o = {};
            for (var i = 0; i < pairCount; i++) {
              var key = regs[base + this._operand()];
              var val = regs[base + this._operand()];
              o[key] = val;
            }
            regs[base + dst] = o;
            break;
          }

        // Object methods (getters / setters)
        case OP.DEFINE_GETTER:
          {
            // obj, key, fn
            var obj = regs[base + this._operand()];
            var key = regs[base + this._operand()];
            var getterFn = regs[base + this._operand()];
            var existingDesc = Object.getOwnPropertyDescriptor(obj, key);
            var getDesc = {
              get: getterFn,
              configurable: true,
              enumerable: true
            };
            if (existingDesc && typeof existingDesc.set === "function") {
              getDesc.set = existingDesc.set;
            }
            Object.defineProperty(obj, key, getDesc);
            break;
          }
        case OP.DEFINE_SETTER:
          {
            // obj, key, fn
            var obj = regs[base + this._operand()];
            var key = regs[base + this._operand()];
            var setterFn = regs[base + this._operand()];
            var existingDesc = Object.getOwnPropertyDescriptor(obj, key);
            var setDesc = {
              set: setterFn,
              configurable: true,
              enumerable: true
            };
            if (existingDesc && typeof existingDesc.get === "function") {
              setDesc.get = existingDesc.get;
            }
            Object.defineProperty(obj, key, setDesc);
            break;
          }

        // ── For-in iteration ──────────────────────────────────────────────────
        case OP.FOR_IN_SETUP:
          {
            // dst, src — build iterator object from enumerable keys of regs[src]
            var dst = this._operand();
            var obj = regs[base + this._operand()];
            var keys = [];
            if (obj !== null && obj !== undefined) {
              var seen = Object.create(null);
              var cur = Object(obj); // box primitives
              while (cur !== null) {
                var ownNames = Object.getOwnPropertyNames(cur);
                for (var i = 0; i < ownNames.length; i++) {
                  var k = ownNames[i];
                  if (!(k in seen)) {
                    seen[k] = true;
                    var propDesc = Object.getOwnPropertyDescriptor(cur, k);
                    if (propDesc && propDesc.enumerable) {
                      keys.push(k);
                    }
                  }
                }
                cur = Object.getPrototypeOf(cur);
              }
            }
            regs[base + dst] = {
              _keys: keys,
              i: 0
            };
            break;
          }
        case OP.FOR_IN_NEXT:
          {
            // dst, iterReg, exitTarget
            // Advances iterator; writes next key to dst, or jumps to exitTarget when done.
            var dst = this._operand();
            var iter = regs[base + this._operand()];
            var exitTarget = this._operand();
            if (iter.i >= iter._keys.length) {
              regs[fp + SLOTS.PC] = exitTarget;
            } else {
              regs[base + dst] = iter._keys[iter.i++];
            }
            break;
          }

        // ── Exception handling ────────────────────────────────────────────────
        case OP.TRY_SETUP:
          {
            // handlerPc, exceptionReg — push exception handler record onto current
            // frame. The handler stack lives in a header slot and is created on
            // first use, so frames that never try/catch carry nothing.
            var hs = regs[fp + SLOTS.HANDLERS];
            if (!hs) regs[fp + SLOTS.HANDLERS] = hs = [];
            hs.push({
              handlerPc: this._operand(),
              exceptionReg: this._operand()
            });
            break;
          }
        case OP.TRY_END:
          {
            // Normal exit from a try block — disarm the top handler record
            // (works for both catch and finally regions; they share the stack).
            regs[fp + SLOTS.HANDLERS].pop();
            break;
          }
        case OP.FINALLY_SETUP:
          {
            // finallyPc, contReg, payloadReg, throwPad
            // Arm a finalizer for the current region.  Unlike a catch record this
            // carries no exceptionReg; instead the continuation register (contReg)
            // receives the resume PC and payloadReg carries the in-flight value.
            var hs = regs[fp + SLOTS.HANDLERS];
            if (!hs) regs[fp + SLOTS.HANDLERS] = hs = [];
            hs.push({
              finallyPc: this._operand(),
              contReg: this._operand(),
              payloadReg: this._operand(),
              throwPad: this._operand()
            });
            break;
          }

        // Self-modifying bytecode
        case OP.PATCH:
          {
            // destPc, sliceStart, sliceEnd, key
            var destPc = this._operand();
            var sliceStart = this._operand();
            var sliceEnd = this._operand();
            var pk = this._operand() ^ destPc | 0;
            for (var pi = sliceStart; pi < sliceEnd; pi++) {
              pk = pk + 0x9e3779b9 | 0;
              // >>> 0: a negative slot would never match a case in the switch.
              this.bytecode[destPc + (pi - sliceStart)] = (this.bytecode[pi] ^ (pk ^ pk >>> 13)) >>> 0;
            }
            break;
          }
        case OP.JUMP_REG:
          {
            // Indirect jump: allows VM to jump based on runtime values.
            regs[fp + SLOTS.PC] = regs[base + this._operand()];
            break;
          }
        case OP.DEBUGGER:
          {
            debugger;
            break;
          }
        default:
          throw new Error("Unknown opcode: " + op + " at pc " + (regs[fp + SLOTS.PC] - 1));
      }
    } catch (err) {
      // Exception handler unwinding
      // Walk the CALLER chain from the current frame until we find one holding an open exception handler (TRY_SETUP without a matching TRY_END).
      // For every frame we abandon along the way, close its captured upvalues and release its block.
      var handledFrame = 0;
      var searchFrame = this._f;
      while (searchFrame) {
        var handlers = regs[searchFrame + SLOTS.HANDLERS];
        if (handlers && handlers.length > 0) {
          handledFrame = searchFrame;
          break;
        }
        // No handler in this frame — abandon it and walk up.
        this._closeUpvaluesFor(searchFrame);
        this._regsTop = searchFrame;
        searchFrame = regs[searchFrame + SLOTS.CALLER];
        this._f = searchFrame;
      }
      if (!handledFrame) throw err; // if there's no handler, propagate back to host

      var h = regs[handledFrame + SLOTS.HANDLERS].pop();
      var hBase = regs[handledFrame + SLOTS.REG_BASE];
      if (h.exceptionReg !== undefined) {
        // catch region — deliver the exception to the catch binding and run it.
        regs[hBase + h.exceptionReg] = err;
        regs[handledFrame + SLOTS.PC] = h.handlerPc;
      } else {
        // finally region: run the finalizer with the exception pending, then
        // resume at its throw pad (which re-raises and continues unwinding).
        regs[hBase + h.contReg] = h.throwPad;
        regs[hBase + h.payloadReg] = err;
        regs[handledFrame + SLOTS.PC] = h.finallyPc;
      }
      // Walking the chain already released every frame pushed inside the
      // protected region; the handling frame is now the top of the stack again.
      this._regsTop = handledFrame + regs[handledFrame + SLOTS.FRAME_SIZE];
      this._f = handledFrame;
    }

    // RETURN of the root frame cleared _f — stop the loop and hand the value
    // back to run()'s caller (host code, or the sub-VM shell) from slot 0.
    if (!this._f) return this._regs[0];
  }
};

/* @BOOT */ // <- This comment can't be removed!
var globals = globalThis;
if (typeof window !== "undefined") {
  globals.window = window;
  globals.document = typeof document !== "undefined" ? document : undefined;
}
if (typeof module !== "undefined") {
  globals.module = module;
  globals.exports = typeof exports !== "undefined" ? exports : undefined;
}
var vm = new VM(decodeBytecode(BYTECODE), CONSTANTS, globals);
vm.run(new Closure({
  paramCount: 0,
  regCount: MAIN_REG_COUNT,
  startPc: MAIN_START_PC
}), undefined, null // no arguments object / parameter setup for the root frame
);