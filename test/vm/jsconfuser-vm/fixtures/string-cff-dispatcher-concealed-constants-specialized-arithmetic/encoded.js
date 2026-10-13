var CONSTANTS = [/* 0 */"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", /* 1 */"CXuIDwqbezVFrUJd", /* 2 */-1225681961, /* 3 */-1027593899, /* 4 */466196371, /* 5 */-815039144, /* 6 */undefined, /* 7 */163957657, /* 8 */-364940579, /* 9 */1342876386, /* 10 */-1596598937, /* 11 */36885457, /* 12 */715912967, /* 13 */-1976774036, /* 14 */-953517721, /* 15 */241602776, /* 16 */-1098771437, /* 17 */-1315987051, /* 18 */329760290, /* 19 */-429876662, /* 20 */-2006344887, /* 21 */-1578504602, /* 22 */-1119809211, /* 23 */-649161566, /* 24 */1832383895, /* 25 */-1557640537, /* 26 */-1236536228, /* 27 */-1897300041, /* 28 */-1664035651, /* 29 */"EhOdvg8F6YXnfs7qxSfBu+ouKlU=", /* 30 */1127567710, /* 31 */"wgDcuMsRyZnXYAzo", /* 32 */"IbK3LSjmqno=", /* 33 */"BCaeugsujVsNxvhK", /* 34 */"jsYNQ43PDHPf5sIt1r3OFvKK+f/wi+oW", /* 35 */"", /* 36 */-259122619, /* 37 */-330439415, /* 38 */-1392726089, /* 39 */-1029848156, /* 40 */1624358640, /* 41 */982469550, /* 42 */195048726, /* 43 */-2055691934, /* 44 */-1312584561, /* 45 */1249522895, /* 46 */611663822, /* 47 */-1299364806, /* 48 */589866305, /* 49 */-53607920, /* 50 */1110822082, /* 51 */89634060, /* 52 */-218233556, /* 53 */-233792262, /* 54 */-470610265, /* 55 */-1797825278, /* 56 */-1517765662, /* 57 */1274276964, /* 58 */-714806174, /* 59 */-1544441186, /* 60 */"e8dQQ1nPPlU=", /* 61 */"IQuykCcp3aE=", /* 62 */-1597897231, /* 63 */-415287816, /* 64 */-608290170, /* 65 */-991088222, /* 66 */876099883, /* 67 */-1426395732, /* 68 */1502079524, /* 69 */-1436673114, /* 70 */-2105085417];
var BYTECODE = [47, 4, 55, 1, 81, 0, 0, 85, 42, 3, 4, 1, 5, 47, 6, 1284, 4, 89, 0, 0, 86, 87, 88, 89, 90, 42, 2, 6, 4, 3, 7, 8, 9, 91, 92, 13, 13, 11, 12, 93, 11, 12, 13, 11, 0, 11, 5, 3479928157, 94, 95, 0, 10, 6, 0, 96, 47, 76, 2575, 3, 10, 0, 0, 97, 0, 16, 7, 163950657, 98, 0, 18, 8, 3930026717, 99, 0, 20, 9, 1342881584, 100, 101, 63, 69, 102, 1, 78, 67877309, 64, 72, 65, 1, 74, 1839, 1, 75, 48152, 62, 0, 22, 10, 2698332972, 103, 104, 105, 63, 1, 73, 1063617810, 1, 78, 4175699419, 64, 78, 65, 1, 74, 36833, 1, 75, 63718, 62, 1, 73, 263276511, 1, 74, 58662, 1, 75, 2331, 62, 0, 24, 11, 36883500, 11, 25, 19, 24, 106, 107, 108, 63, 69, 1, 73, 239776783, 1, 78, 3351858392, 64, 79, 65, 1, 74, 23251, 1, 75, 15177, 62, 1, 73, 1026632055, 1, 74, 10057, 1, 75, 23043, 62, 0, 27, 12, 715900432, 12, 28, 19, 27, 5, 19, 28, 109, 34, 77, 29, 63, 69, 1, 73, 2222160244, 1, 78, 3761108761, 64, 72, 65, 1, 74, 46967, 1, 75, 18210, 62, 1, 73, 1830248592, 1, 74, 14165, 1, 75, 6017, 62, 0, 30, 13, 2318196109, 11, 31, 19, 30, 5, 19, 31, 110, 34, 77, 32, 63, 1, 73, 3165500492, 1, 78, 1196048259, 64, 80, 65, 1, 74, 37893, 1, 75, 60521, 62, 1, 73, 2263834229, 1, 74, 13358, 1, 75, 4852, 62, 0, 33, 14, 3341439863, 11, 34, 19, 33, 5, 19, 34, 26, 35, 17, 19, 34, 77, 35, 63, 69, 1, 73, 1913771937, 1, 78, 3846003727, 64, 72, 65, 1, 74, 37081, 1, 75, 27796, 62, 1, 73, 3090562720, 1, 74, 26078, 1, 75, 40962, 62, 0, 36, 15, 241599510, 12, 37, 19, 36, 5, 19, 37, 26, 38, 17, 19, 34, 77, 38, 63, 1, 73, 1469536234, 1, 78, 3795051297, 64, 78, 65, 1, 74, 4272, 1, 75, 59556, 62, 1, 73, 2693081334, 1, 74, 43924, 1, 75, 50037, 62, 0, 39, 16, 3196192454, 11, 40, 19, 39, 5, 19, 40, 26, 41, 17, 19, 34, 77, 41, 63, 69, 1, 73, 909496413, 1, 78, 2666732656, 64, 72, 65, 1, 74, 44778, 1, 75, 19980, 62, 1, 73, 447445742, 1, 74, 60111, 1, 75, 61454, 62, 0, 42, 17, 2978973816, 11, 43, 19, 42, 5, 19, 43, 26, 44, 17, 19, 34, 77, 44, 63, 69, 1, 73, 2900350316, 1, 78, 930898083, 64, 72, 65, 1, 74, 46880, 1, 75, 47233, 62, 1, 73, 652775030, 1, 74, 21555, 1, 75, 39441, 62, 0, 45, 18, 329764124, 12, 46, 19, 45, 5, 19, 46, 26, 47, 17, 19, 34, 77, 47, 63, 69, 1, 73, 3232391200, 1, 78, 3054359785, 64, 72, 65, 1, 74, 1621, 1, 75, 63877, 62, 1, 73, 2875769965, 1, 74, 4923, 1, 75, 2449, 62, 0, 48, 19, 3865096360, 12, 49, 19, 48, 5, 19, 49, 26, 50, 17, 19, 34, 77, 50, 63, 69, 1, 73, 2492750251, 1, 78, 3319573108, 64, 72, 65, 1, 74, 6313, 1, 75, 16636, 62, 1, 73, 2292687141, 1, 74, 48068, 1, 75, 64152, 62, 0, 51, 20, 2288618524, 11, 52, 19, 51, 5, 19, 52, 26, 53, 17, 19, 34, 77, 53, 63, 1, 73, 2498806818, 1, 78, 2145779856, 64, 80, 65, 1, 74, 15082, 1, 75, 17358, 62, 1, 73, 1815718929, 1, 74, 28335, 1, 75, 3810, 62, 0, 54, 21, 2716447597, 12, 55, 19, 54, 5, 19, 55, 26, 56, 17, 19, 34, 77, 56, 63, 69, 1, 73, 2473831117, 1, 78, 1396535023, 64, 72, 65, 1, 74, 64816, 1, 75, 59696, 62, 1, 73, 2376721609, 1, 74, 1070, 1, 75, 19758, 62, 0, 57, 22, 3175188937, 11, 58, 19, 57, 5, 19, 58, 26, 59, 17, 19, 34, 77, 59, 63, 1, 73, 3934176499, 1, 78, 3537857358, 64, 80, 65, 1, 74, 29896, 1, 75, 65228, 62, 1, 73, 1469960299, 1, 74, 22245, 1, 75, 27783, 62, 0, 60, 23, 3645831975, 12, 61, 19, 60, 5, 19, 61, 26, 62, 17, 19, 34, 77, 62, 63, 69, 1, 73, 3542054354, 1, 78, 2577456393, 64, 72, 65, 1, 74, 52625, 1, 75, 20014, 62, 1, 73, 2102853634, 1, 74, 56207, 1, 75, 29197, 62, 0, 63, 24, 1832339491, 11, 64, 19, 63, 5, 19, 64, 26, 65, 17, 19, 34, 77, 65, 63, 1, 73, 2974328547, 1, 78, 2621301585, 64, 78, 65, 1, 74, 16272, 1, 75, 41057, 62, 1, 73, 2008534255, 1, 74, 20981, 1, 75, 25012, 62, 0, 66, 25, 2737314274, 12, 67, 19, 66, 5, 19, 67, 26, 68, 17, 19, 34, 77, 68, 63, 69, 1, 73, 2504116106, 1, 78, 752951599, 64, 79, 65, 1, 74, 1557, 1, 75, 13249, 62, 1, 73, 3646301168, 1, 74, 195, 1, 75, 43381, 62, 0, 69, 26, 3058427512, 11, 70, 19, 69, 5, 19, 70, 26, 71, 17, 19, 34, 77, 71, 63, 1, 73, 1775941221, 1, 78, 3883168558, 64, 78, 65, 1, 74, 18023, 1, 75, 47903, 62, 1, 73, 1023539775, 1, 74, 15703, 1, 75, 64967, 62, 1, 73, 2471485824, 1, 74, 17807, 1, 75, 17095, 62, 11, 79, 5, 13, 43, 12, 3, 11, 1, 79, 0, 14, 27, 2397667263, 1, 72, 39052, 73, 1, 73, 4222078970, 1, 74, 20492, 1, 75, 23587, 62, 0, 79, 28, 2630931647, 11, 80, 5, 79, 5, 5, 80, 1, 72, 11474, 74, 1, 73, 3107483811, 1, 74, 21545, 1, 75, 57630, 62, 1, 72, 13931, 73, 1, 73, 3747621707, 1, 74, 53984, 1, 75, 25219, 62, 111, 112, 43, 9, 7, 8, 1, 80, 1, 72, 1722, 74, 1, 73, 1146788126, 1, 74, 25836, 1, 75, 64501, 62, 0, 79, 29, 4029277889, 113, 0, 13, 30, 1127567711, 1, 72, 42394, 74, 1, 73, 1024029931, 1, 74, 15670, 1, 75, 57529, 62, 11, 79, 4, 9, 5, 4, 79, 1, 72, 21737, 73, 1, 73, 1474413734, 1, 74, 57385, 1, 75, 7266, 62, 1, 72, 33841, 83, 84, 63, 1, 73, 4103733298, 1, 78, 2134281065, 64, 80, 65, 1, 74, 5673, 1, 75, 33107, 62, 1, 72, 20996, 74, 1, 73, 546200016, 1, 74, 40829, 1, 75, 54301, 62, 1, 72, 741, 73, 1, 73, 801285754, 1, 74, 31100, 1, 75, 60026, 62, 0, 79, 31, 1865871908, 114, 115, 34, 77, 79, 63, 69, 1, 73, 1689063396, 1, 78, 4014578459, 64, 79, 65, 1, 74, 6767, 1, 75, 26054, 62, 1, 72, 9843, 74, 1, 73, 2088625842, 1, 74, 29427, 1, 75, 12654, 62, 1, 72, 29747, 74, 1, 73, 2447817593, 1, 74, 16406, 1, 75, 24066, 62, 116, 0, 79, 29, 4029277889, 117, 43, 10, 3, 80, 1, 5, 1, 72, 9129, 73, 1, 73, 3086211653, 1, 74, 49355, 1, 75, 51099, 62, 0, 79, 6, 0, 118, 119, 120, 42, 6, 79, 1, 0, 1, 72, 17008, 73, 1, 73, 3820676587, 1, 74, 38955, 1, 75, 31172, 62, 1, 72, 378, 74, 1, 73, 3768733357, 1, 74, 60267, 1, 75, 49913, 62, 1, 72, 34308, 83, 84, 63, 69, 1, 73, 3458633167, 1, 78, 2388445613, 64, 79, 65, 1, 74, 51561, 1, 75, 2594, 62, 1, 72, 30252, 74, 1, 73, 1559528634, 1, 74, 54093, 1, 75, 58560, 62, 1, 72, 0, 73, 1, 73, 1592473838, 1, 74, 62057, 1, 75, 23524, 62, 121, 0, 79, 34, 3249455136, 122, 1, 72, 15419, 73, 1, 73, 919456137, 1, 74, 7459, 1, 75, 4089, 62, 5, 3, 6, 0, 79, 35, 511988258, 5, 4, 79, 1, 72, 8189, 74, 1, 73, 4013948459, 1, 74, 63673, 1, 75, 3885, 62, 0, 79, 8, 3930026717, 5, 5, 79, 1, 72, 9950, 73, 1, 73, 1611022954, 1, 74, 40460, 1, 75, 44230, 62, 42, 73, 76, 3, 73, 74, 75, 123, 47, 84, 2725, 3, 10, 0, 0, 124, 0, 21, 36, 4035882083, 5, 22, 21, 0, 23, 8, 3930026717, 5, 24, 23, 0, 25, 37, 3964479750, 125, 34, 85, 26, 66, 1, 81, 3347564137, 1, 86, 1323652863, 67, 77, 68, 1, 82, 8639, 1, 83, 61695, 61, 0, 27, 38, 2902211828, 5, 24, 27, 26, 28, 22, 24, 34, 85, 28, 66, 1, 81, 1150139250, 1, 86, 1281860604, 67, 81, 68, 1, 82, 34819, 1, 83, 37774, 61, 1, 81, 1595067337, 1, 82, 54857, 1, 83, 35382, 61, 0, 29, 39, 3265120685, 11, 30, 24, 29, 5, 24, 30, 26, 31, 22, 24, 34, 85, 31, 66, 70, 1, 81, 4003251096, 1, 86, 1492533502, 67, 75, 68, 1, 82, 46696, 1, 83, 63727, 61, 1, 81, 1304993952, 1, 82, 25822, 1, 83, 52516, 61, 0, 32, 40, 1624320382, 12, 33, 24, 32, 5, 24, 33, 26, 34, 22, 24, 34, 85, 34, 66, 70, 1, 81, 2385150232, 1, 86, 2516875418, 67, 82, 68, 1, 82, 5122, 1, 83, 41917, 61, 1, 81, 1796045342, 1, 82, 63946, 1, 83, 64135, 61, 0, 35, 41, 982514630, 11, 36, 24, 35, 5, 24, 36, 26, 37, 22, 24, 34, 85, 37, 66, 1, 81, 2339093063, 1, 86, 3660310355, 67, 81, 68, 1, 82, 24064, 1, 83, 6388, 61, 1, 81, 80746225, 1, 82, 25288, 1, 83, 32052, 61, 0, 38, 42, 195052464, 12, 39, 24, 38, 5, 24, 39, 26, 40, 22, 24, 34, 85, 40, 66, 1, 81, 2102027855, 1, 86, 54335912, 67, 81, 68, 1, 82, 26196, 1, 83, 107, 61, 1, 81, 1704550681, 1, 82, 49374, 1, 83, 28676, 61, 0, 41, 43, 2239278522, 12, 42, 24, 41, 5, 24, 42, 26, 43, 22, 24, 34, 85, 43, 66, 1, 81, 4075754391, 1, 86, 2291510320, 67, 77, 68, 1, 82, 29527, 1, 83, 36547, 61, 1, 81, 1238875085, 1, 82, 59344, 1, 83, 48154, 61, 0, 44, 44, 2982365171, 11, 45, 24, 44, 5, 24, 45, 26, 46, 22, 24, 34, 85, 46, 66, 1, 81, 394572473, 1, 86, 989321326, 67, 77, 68, 1, 82, 54986, 1, 83, 62681, 61, 1, 81, 2556366653, 1, 82, 52423, 1, 83, 59965, 61, 0, 47, 45, 1249519284, 12, 48, 24, 47, 5, 24, 48, 26, 49, 22, 24, 34, 85, 49, 66, 1, 81, 776674383, 1, 86, 3750423379, 67, 77, 68, 1, 82, 37567, 1, 83, 3199, 61, 1, 81, 2560613923, 1, 82, 6820, 1, 83, 42937, 61, 0, 50, 46, 611707965, 12, 51, 24, 50, 5, 24, 51, 26, 52, 22, 24, 34, 85, 52, 66, 70, 1, 81, 2144157755, 1, 86, 1876707642, 67, 75, 68, 1, 82, 59703, 1, 83, 53588, 61, 1, 81, 2846328370, 1, 82, 11809, 1, 83, 7731, 61, 0, 53, 47, 2995627984, 11, 54, 24, 53, 5, 24, 54, 26, 55, 22, 24, 34, 85, 55, 66, 1, 81, 3085379198, 1, 86, 1764160402, 67, 77, 68, 1, 82, 43103, 1, 83, 49204, 61, 1, 81, 4241832059, 1, 82, 551, 1, 83, 24735, 61, 0, 56, 48, 589824350, 12, 57, 24, 56, 5, 24, 57, 26, 58, 22, 24, 34, 85, 58, 66, 1, 81, 502748960, 1, 86, 371027870, 67, 77, 68, 1, 82, 50997, 1, 83, 7004, 61, 1, 81, 4142613282, 1, 82, 10368, 1, 83, 59663, 61, 0, 59, 49, 4241374529, 11, 60, 24, 59, 5, 24, 60, 26, 61, 22, 24, 34, 85, 61, 66, 70, 1, 81, 3676555008, 1, 86, 2355337844, 67, 75, 68, 1, 82, 7770, 1, 83, 3509, 61, 1, 81, 2817659480, 1, 82, 43857, 1, 83, 39251, 61, 0, 62, 50, 1110808927, 12, 63, 24, 62, 5, 24, 63, 26, 64, 22, 24, 34, 85, 64, 66, 70, 1, 81, 1445564543, 1, 86, 850816566, 67, 82, 68, 1, 82, 61893, 1, 83, 59866, 61, 1, 81, 1220818844, 1, 82, 64622, 1, 83, 35881, 61, 0, 65, 51, 89624959, 11, 66, 24, 65, 5, 24, 66, 26, 67, 22, 24, 34, 85, 67, 66, 70, 1, 81, 2459714510, 1, 86, 4243967272, 67, 75, 68, 1, 82, 52284, 1, 83, 43374, 61, 1, 81, 2916498653, 1, 82, 14893, 1, 83, 32795, 61, 0, 68, 52, 4076760130, 11, 69, 24, 68, 5, 24, 69, 26, 70, 22, 24, 34, 85, 70, 66, 70, 1, 81, 2744043925, 1, 86, 696351029, 67, 82, 68, 1, 82, 18841, 1, 83, 5592, 61, 1, 81, 3538858232, 1, 82, 9038, 1, 83, 30889, 61, 0, 71, 53, 4061141187, 12, 72, 24, 71, 5, 24, 72, 26, 73, 22, 24, 34, 85, 73, 66, 70, 1, 81, 934622532, 1, 86, 1817131259, 67, 75, 68, 1, 82, 27219, 1, 83, 35682, 61, 1, 81, 2408846276, 1, 82, 65402, 1, 83, 497, 61, 0, 74, 54, 3824370806, 12, 75, 24, 74, 5, 24, 75, 26, 76, 22, 24, 34, 85, 76, 66, 70, 1, 81, 2229081179, 1, 86, 181392570, 67, 75, 68, 1, 82, 47921, 1, 83, 10422, 61, 1, 81, 69319958, 1, 82, 38991, 1, 83, 53018, 61, 0, 77, 55, 2497155311, 11, 78, 24, 77, 5, 24, 78, 26, 79, 22, 24, 34, 85, 79, 66, 70, 1, 81, 972518846, 1, 86, 3682821017, 67, 75, 68, 1, 82, 45673, 1, 83, 15604, 61, 1, 81, 4026247739, 1, 82, 21039, 1, 83, 9019, 61, 1, 81, 2821120979, 1, 82, 27923, 1, 83, 24819, 61, 126, 127, 43, 88, 14, 15, 1, 87, 11, 18, 6, 88, 1, 80, 24792, 76, 1, 81, 1479889443, 1, 82, 29486, 1, 83, 14388, 61, 1, 80, 12016, 128, 34, 85, 80, 66, 70, 1, 81, 2792368653, 1, 86, 1008118699, 67, 75, 68, 1, 82, 19579, 1, 83, 14243, 61, 1, 80, 37928, 71, 1, 81, 623265871, 1, 82, 20904, 1, 83, 43481, 61, 1, 80, 4087, 76, 1, 81, 1468452365, 1, 82, 51862, 1, 83, 3040, 61, 0, 87, 34, 3249455136, 8, 15, 14, 87, 0, 16, 29, 4029277889, 1, 80, 36036, 71, 1, 81, 2451167335, 1, 82, 31542, 1, 83, 52397, 61, 129, 34, 85, 87, 66, 70, 1, 81, 1013158695, 1, 86, 2334376019, 67, 75, 68, 1, 82, 31165, 1, 83, 19664, 61, 1, 80, 38392, 71, 1, 81, 464911378, 1, 82, 22119, 1, 83, 755, 61, 1, 80, 25806, 71, 1, 81, 4119732425, 1, 82, 261, 1, 83, 4343, 61, 130, 131, 0, 13, 56, 2777170973, 1, 80, 10186, 76, 1, 81, 3520361619, 1, 82, 22647, 1, 83, 8884, 61, 5, 87, 7, 0, 87, 30, 1127567711, 11, 19, 7, 87, 1, 80, 40046, 71, 1, 81, 345515061, 1, 82, 54383, 1, 83, 36159, 61, 132, 5, 1, 87, 0, 11, 57, 1274276969, 1, 80, 4600, 76, 1, 81, 3008932197, 1, 82, 39590, 1, 83, 64531, 61, 1, 80, 21443, 71, 1, 81, 1846726385, 1, 82, 14066, 1, 83, 19487, 61, 5, 6, 18, 1, 80, 12046, 71, 1, 81, 1899843561, 1, 82, 41613, 1, 83, 58241, 61, 8, 87, 0, 16, 11, 88, 2, 7, 43, 17, 0, 87, 1, 88, 1, 80, 23575, 76, 1, 81, 2274610014, 1, 82, 42490, 1, 83, 55626, 61, 0, 87, 6, 0, 45, 87, 16, 87, 12, 13, 5, 8, 87, 133, 1, 80, 36473, 76, 1, 81, 2498962184, 1, 82, 18004, 1, 83, 45377, 61, 0, 87, 8, 3930026717, 5, 7, 87, 1, 80, 45251, 76, 1, 81, 1761298278, 1, 82, 53971, 1, 83, 13054, 61, 1, 80, 6145, 71, 1, 81, 1848669688, 1, 82, 64197, 1, 83, 8305, 61, 0, 87, 58, 1263769051, 11, 9, 1, 87, 0, 10, 8, 3930026717, 1, 80, 37140, 71, 1, 81, 912881552, 1, 82, 44390, 1, 83, 20645, 61, 4, 5, 0, 87, 35, 511988258, 5, 6, 87, 1, 80, 27465, 71, 1, 81, 129953103, 1, 82, 39443, 1, 83, 14117, 61, 5, 7, 19, 1, 80, 51448, 76, 1, 81, 1548598989, 1, 82, 22, 1, 83, 35552, 61, 42, 81, 84, 3, 81, 82, 83, 134, 4, 4, 0, 6, 59, 2750526094, 135, 136, 0, 7, 8, 3930026717, 137, 5, 5, 8, 2, 6, 60, 2543448068, 0, 7, 61, 1215546456, 8, 8, 6, 7, 0, 7, 62, 2226522486, 43, 9, 6, 8, 2, 0, 7, 0, 6, 8, 3930026717, 138, 5, 0, 7, 0, 6, 63, 1691330938, 12, 7, 0, 6, 0, 6, 8, 3930026717, 139, 5, 0, 8, 0, 6, 64, 3686677139, 21, 7, 0, 6, 140, 0, 7, 8, 3930026717, 21, 8, 6, 7, 5, 0, 8, 0, 6, 4, 466196368, 141, 0, 6, 65, 3303879103, 21, 8, 0, 6, 142, 0, 7, 8, 3930026717, 21, 8, 6, 7, 5, 0, 8, 11, 6, 0, 5, 0, 7, 8, 3930026717, 21, 8, 6, 7, 5, 0, 8, 0, 6, 66, 3407243665, 11, 7, 0, 6, 0, 6, 8, 3930026717, 21, 8, 7, 6, 5, 0, 8, 45, 0, 0, 6, 6, 0, 45, 6, 4, 4, 0, 6, 59, 2750526094, 143, 17, 6, 1, 7, 0, 7, 8, 3930026717, 21, 8, 6, 7, 5, 5, 8, 0, 6, 67, 2868571576, 21, 7, 0, 6, 144, 0, 7, 8, 3930026717, 21, 8, 6, 7, 5, 0, 8, 2, 6, 60, 2543448068, 0, 7, 61, 1215546456, 8, 8, 6, 7, 0, 7, 68, 155027127, 43, 9, 6, 8, 2, 0, 7, 0, 6, 8, 3930026717, 21, 7, 9, 6, 5, 0, 7, 0, 6, 69, 2858294192, 19, 7, 0, 6, 0, 6, 70, 2189881885, 21, 8, 0, 6, 17, 6, 7, 8, 0, 7, 8, 3930026717, 21, 8, 6, 7, 5, 0, 8, 18, 6, 0, 5, 0, 7, 8, 3930026717, 21, 8, 6, 7, 5, 0, 8, 45, 0, 0, 6, 6, 0, 45, 6];
var MAIN_START_PC = 0;
var MAIN_REG_COUNT = 14;
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
        case 61:
          {
            // JUMP_2567 (specialized)
            regs[fp + SLOTS.PC] = 2567;
            break;
          }
        case 62:
          {
            // JUMP_1276 (specialized)
            regs[fp + SLOTS.PC] = 1276;
            break;
          }
        case 63:
          {
            // UNARY_POS_77_77 (specialized)
            var dst = 77;
            regs[base + dst] = +regs[base + 77];
            break;
          }
        case 64:
          {
            // SUB_78_78_73 (specialized)
            var dst = 78;
            var a = regs[base + 78];
            regs[base + dst] = a - regs[base + 73];
            break;
          }
        case 65:
          {
            // ADD_73_73_78 (specialized)
            var dst = 73;
            var a = regs[base + 73];
            regs[base + dst] = a + regs[base + 78];
            break;
          }
        case 66:
          {
            // UNARY_POS_85_85 (specialized)
            var dst = 85;
            regs[base + dst] = +regs[base + 85];
            break;
          }
        case 67:
          {
            // SUB_86_86_81 (specialized)
            var dst = 86;
            var a = regs[base + 86];
            regs[base + dst] = a - regs[base + 81];
            break;
          }
        case 68:
          {
            // ADD_81_81_86 (specialized)
            var dst = 81;
            var a = regs[base + 81];
            regs[base + dst] = a + regs[base + 86];
            break;
          }
        case 69:
          {
            // UNARY_NEG_77_77 (specialized)
            var dst = 77;
            regs[base + dst] = -regs[base + 77];
            break;
          }
        case 70:
          {
            // UNARY_NEG_85_85 (specialized)
            var dst = 85;
            regs[base + dst] = -regs[base + 85];
            break;
          }
        case 71:
          {
            // SUB_22_22_80 (specialized)
            var dst = 22;
            var a = regs[base + 22];
            regs[base + dst] = a - regs[base + 80];
            break;
          }
        case 72:
          {
            // BAND_78_78_77 (specialized)
            var dst = 78;
            var a = regs[base + 78];
            regs[base + dst] = a & regs[base + 77];
            break;
          }
        case 73:
          {
            // ADD_17_17_72 (specialized)
            var dst = 17;
            var a = regs[base + 17];
            regs[base + dst] = a + regs[base + 72];
            break;
          }
        case 74:
          {
            // SUB_17_17_72 (specialized)
            var dst = 17;
            var a = regs[base + 17];
            regs[base + dst] = a - regs[base + 72];
            break;
          }
        case 75:
          {
            // BAND_86_85_86 (specialized)
            var dst = 86;
            var a = regs[base + 85];
            regs[base + dst] = a & regs[base + 86];
            break;
          }
        case 76:
          {
            // ADD_22_22_80 (specialized)
            var dst = 22;
            var a = regs[base + 22];
            regs[base + dst] = a + regs[base + 80];
            break;
          }
        case 77:
          {
            // MUL_86_86_85 (specialized)
            var dst = 86;
            var a = regs[base + 86];
            regs[base + dst] = a * regs[base + 85];
            break;
          }
        case 78:
          {
            // MUL_78_78_77 (specialized)
            var dst = 78;
            var a = regs[base + 78];
            regs[base + dst] = a * regs[base + 77];
            break;
          }
        case 79:
          {
            // BAND_78_77_78 (specialized)
            var dst = 78;
            var a = regs[base + 77];
            regs[base + dst] = a & regs[base + 78];
            break;
          }
        case 80:
          {
            // MUL_78_77_78 (specialized)
            var dst = 78;
            var a = regs[base + 77];
            regs[base + dst] = a * regs[base + 78];
            break;
          }
        case 81:
          {
            // MUL_86_85_86 (specialized)
            var dst = 86;
            var a = regs[base + 85];
            regs[base + dst] = a * regs[base + 86];
            break;
          }
        case 82:
          {
            // BAND_86_86_85 (specialized)
            var dst = 86;
            var a = regs[base + 86];
            regs[base + dst] = a & regs[base + 85];
            break;
          }
        case 83:
          {
            // LT_72_17_72 (specialized)
            var dst = 72;
            var a = regs[base + 17];
            regs[base + dst] = a < regs[base + 72];
            break;
          }
        case 84:
          {
            // UNARY_NOT_77_72 (specialized)
            var dst = 77;
            regs[base + dst] = !regs[base + 72];
            break;
          }
        case 85:
          {
            // LOAD_CONST_5_0_3995359512 (specialized)
            var dst = 5;
            regs[base + dst] = this._constant(0, 3995359512);
            break;
          }
        case 86:
          {
            // LOAD_THIS_1 (specialized)
            var dst = 1;
            regs[base + dst] = regs[fp + SLOTS.THIS];
            break;
          }
        case 87:
          {
            // LOAD_GLOBAL_10_1_2455668248 (specialized)
            var dst = 10;
            var globalName = this._constant(1, 2455668248);
            if (!(globalName in this.globals)) {
              throw new ReferenceError(`${globalName} is not defined`);
            }
            regs[base + dst] = this.globals[globalName];
            break;
          }
        case 88:
          {
            // LOAD_INT_7_2169651486 (specialized)
            var dst = 7;
            regs[base + dst] = 2169651486;
            break;
          }
        case 89:
          {
            // LOAD_INT_8_228 (specialized)
            var dst = 8;
            regs[base + dst] = 228;
            break;
          }
        case 90:
          {
            // LOAD_INT_9_11 (specialized)
            var dst = 9;
            regs[base + dst] = 11;
            break;
          }
        case 91:
          {
            // LOAD_CONST_11_2_3069285329 (specialized)
            var dst = 11;
            regs[base + dst] = this._constant(2, 3069285329);
            break;
          }
        case 92:
          {
            // LOAD_CONST_12_3_3267373394 (specialized)
            var dst = 12;
            regs[base + dst] = this._constant(3, 3267373394);
            break;
          }
        case 93:
          {
            // LOAD_CONST_11_4_466196368 (specialized)
            var dst = 11;
            regs[base + dst] = this._constant(4, 466196368);
            break;
          }
        case 94:
          {
            // MOD_13_12_11 (specialized)
            var dst = 13;
            var a = regs[base + 12];
            regs[base + dst] = a % regs[base + 11];
            break;
          }
        case 95:
          {
            // SET_PROP_10_2_13 (specialized)
            // regs[obj][regs[key]] = regs[val]
            var obj = regs[base + 10];
            var key = regs[base + 2];
            var val = regs[base + 13];
            // Reflect.set performs [[Set]] without throwing on failure (non-strict mode behavior)
            // Reflect.set performs [[Set]] without throwing on failure (non-strict mode behavior)
            Reflect.set(obj, key, val);
            break;
          }
        case 96:
          {
            // RETURN_10 (specialized)
            var retVal = regs[base + 10];
            this._closeUpvaluesFor(fp); // must happen before frame is abandoned

            // must happen before frame is abandoned

            var caller = regs[fp + SLOTS.CALLER];
            var retDst = regs[fp + SLOTS.RET_DST];

            // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
            // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
            if (retDst & 1 && (typeof retVal !== "object" || retVal === null)) retVal = regs[fp + SLOTS.THIS];

            // Zero out the callee's whole block (header included) to limit
            // exposing runtime values, then hand the slots back.
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
            // A caller of 0 is the root frame returning to the host: park the
            // value in slot 0 for run() to hand back. A bare `return retVal`
            // would only exit an extracted VM.prototype[op] handler function
            // (handlerTable option), not the loop. Keeping the sole `break`
            // trailing (no mid-body break/return) also lets the handlerTable
            // transform lift this body verbatim.
            regs[caller ? regs[caller + SLOTS.REG_BASE] + (retDst >> 1) : 0] = retVal;
            break;
          }
        case 97:
          {
            // LOAD_THIS_15 (specialized)
            var dst = 15;
            regs[base + dst] = regs[fp + SLOTS.THIS];
            break;
          }
        case 98:
          {
            // MOVE_17_16 (specialized)
            var dst = 17;
            regs[base + dst] = regs[base + 16];
            break;
          }
        case 99:
          {
            // MOVE_19_18 (specialized)
            var dst = 19;
            regs[base + dst] = regs[base + 18];
            break;
          }
        case 100:
          {
            // NEQ_21_17_20 (specialized)
            var dst = 21;
            var a = regs[base + 17];
            regs[base + dst] = a !== regs[base + 20];
            break;
          }
        case 101:
          {
            // UNARY_NOT_77_21 (specialized)
            var dst = 77;
            regs[base + dst] = !regs[base + 21];
            break;
          }
        case 102:
          {
            // LOAD_INT_73_2909999316 (specialized)
            var dst = 73;
            regs[base + dst] = 2909999316;
            break;
          }
        case 103:
          {
            // MOVE_19_22 (specialized)
            var dst = 19;
            regs[base + dst] = regs[base + 22];
            break;
          }
        case 104:
          {
            // EQ_23_17_19 (specialized)
            var dst = 23;
            var a = regs[base + 17];
            regs[base + dst] = a === regs[base + 19];
            break;
          }
        case 105:
          {
            // UNARY_NOT_77_23 (specialized)
            var dst = 77;
            regs[base + dst] = !regs[base + 23];
            break;
          }
        case 106:
          {
            // MOVE_19_25 (specialized)
            var dst = 19;
            regs[base + dst] = regs[base + 25];
            break;
          }
        case 107:
          {
            // EQ_26_17_19 (specialized)
            var dst = 26;
            var a = regs[base + 17];
            regs[base + dst] = a === regs[base + 19];
            break;
          }
        case 108:
          {
            // UNARY_NOT_77_26 (specialized)
            var dst = 77;
            regs[base + dst] = !regs[base + 26];
            break;
          }
        case 109:
          {
            // EQ_29_17_19 (specialized)
            var dst = 29;
            var a = regs[base + 17];
            regs[base + dst] = a === regs[base + 19];
            break;
          }
        case 110:
          {
            // EQ_32_17_19 (specialized)
            var dst = 32;
            var a = regs[base + 17];
            regs[base + dst] = a === regs[base + 19];
            break;
          }
        case 111:
          {
            // SHL_79_12_14 (specialized)
            var dst = 79;
            var a = regs[base + 12];
            regs[base + dst] = a << regs[base + 14];
            break;
          }
        case 112:
          {
            // BOR_80_10_79 (specialized)
            var dst = 80;
            var a = regs[base + 10];
            regs[base + dst] = a | regs[base + 79];
            break;
          }
        case 113:
          {
            // GET_PROP_11_3_79 (specialized)
            // dst = regs[obj][regs[key]]
            var dst = 11;
            var obj = regs[base + 3];
            var key = regs[base + 79];
            regs[base + dst] = obj[key];
            break;
          }
        case 114:
          {
            // GET_PROP_80_3_79 (specialized)
            // dst = regs[obj][regs[key]]
            var dst = 80;
            var obj = regs[base + 3];
            var key = regs[base + 79];
            regs[base + dst] = obj[key];
            break;
          }
        case 115:
          {
            // LT_79_5_80 (specialized)
            var dst = 79;
            var a = regs[base + 5];
            regs[base + dst] = a < regs[base + 80];
            break;
          }
        case 116:
          {
            // RETURN_4 (specialized)
            var retVal = regs[base + 4];
            this._closeUpvaluesFor(fp); // must happen before frame is abandoned

            // must happen before frame is abandoned

            var caller = regs[fp + SLOTS.CALLER];
            var retDst = regs[fp + SLOTS.RET_DST];

            // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
            // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
            if (retDst & 1 && (typeof retVal !== "object" || retVal === null)) retVal = regs[fp + SLOTS.THIS];

            // Zero out the callee's whole block (header included) to limit
            // exposing runtime values, then hand the slots back.
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
            // A caller of 0 is the root frame returning to the host: park the
            // value in slot 0 for run() to hand back. A bare `return retVal`
            // would only exit an extracted VM.prototype[op] handler function
            // (handlerTable option), not the loop. Keeping the sole `break`
            // trailing (no mid-body break/return) also lets the handlerTable
            // transform lift this body verbatim.
            regs[caller ? regs[caller + SLOTS.REG_BASE] + (retDst >> 1) : 0] = retVal;
            break;
          }
        case 117:
          {
            // GET_PROP_80_3_79 (specialized)
            // dst = regs[obj][regs[key]]
            var dst = 80;
            var obj = regs[base + 3];
            var key = regs[base + 79];
            regs[base + dst] = obj[key];
            break;
          }
        case 118:
          {
            // RETURN_79 (specialized)
            var retVal = regs[base + 79];
            this._closeUpvaluesFor(fp); // must happen before frame is abandoned

            // must happen before frame is abandoned

            var caller = regs[fp + SLOTS.CALLER];
            var retDst = regs[fp + SLOTS.RET_DST];

            // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
            // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
            if (retDst & 1 && (typeof retVal !== "object" || retVal === null)) retVal = regs[fp + SLOTS.THIS];

            // Zero out the callee's whole block (header included) to limit
            // exposing runtime values, then hand the slots back.
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
            // A caller of 0 is the root frame returning to the host: park the
            // value in slot 0 for run() to hand back. A bare `return retVal`
            // would only exit an extracted VM.prototype[op] handler function
            // (handlerTable option), not the loop. Keeping the sole `break`
            // trailing (no mid-body break/return) also lets the handlerTable
            // transform lift this body verbatim.
            regs[caller ? regs[caller + SLOTS.REG_BASE] + (retDst >> 1) : 0] = retVal;
            break;
          }
        case 119:
          {
            // LOAD_THIS_2 (specialized)
            var dst = 2;
            regs[base + dst] = regs[fp + SLOTS.THIS];
            break;
          }
        case 120:
          {
            // LOAD_GLOBAL_79_32_219639422 (specialized)
            var dst = 79;
            var globalName = this._constant(32, 219639422);
            if (!(globalName in this.globals)) {
              throw new ReferenceError(`${globalName} is not defined`);
            }
            regs[base + dst] = this.globals[globalName];
            break;
          }
        case 121:
          {
            // LOAD_GLOBAL_7_33_2508669417 (specialized)
            var dst = 7;
            var globalName = this._constant(33, 2508669417);
            if (!(globalName in this.globals)) {
              throw new ReferenceError(`${globalName} is not defined`);
            }
            regs[base + dst] = this.globals[globalName];
            break;
          }
        case 122:
          {
            // GET_PROP_8_7_79 (specialized)
            // dst = regs[obj][regs[key]]
            var dst = 8;
            var obj = regs[base + 7];
            var key = regs[base + 79];
            regs[base + dst] = obj[key];
            break;
          }
        case 123:
          {
            // JUMP_REG_73 (specialized)
            // Indirect jump: allows VM to jump based on runtime values.
            regs[fp + SLOTS.PC] = regs[base + 73];
            break;
          }
        case 124:
          {
            // LOAD_THIS_20 (specialized)
            var dst = 20;
            regs[base + dst] = regs[fp + SLOTS.THIS];
            break;
          }
        case 125:
          {
            // NEQ_26_22_25 (specialized)
            var dst = 26;
            var a = regs[base + 22];
            regs[base + dst] = a !== regs[base + 25];
            break;
          }
        case 126:
          {
            // RETURN_6 (specialized)
            var retVal = regs[base + 6];
            this._closeUpvaluesFor(fp); // must happen before frame is abandoned

            // must happen before frame is abandoned

            var caller = regs[fp + SLOTS.CALLER];
            var retDst = regs[fp + SLOTS.RET_DST];

            // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
            // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
            if (retDst & 1 && (typeof retVal !== "object" || retVal === null)) retVal = regs[fp + SLOTS.THIS];

            // Zero out the callee's whole block (header included) to limit
            // exposing runtime values, then hand the slots back.
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
            // A caller of 0 is the root frame returning to the host: park the
            // value in slot 0 for run() to hand back. A bare `return retVal`
            // would only exit an extracted VM.prototype[op] handler function
            // (handlerTable option), not the loop. Keeping the sole `break`
            // trailing (no mid-body break/return) also lets the handlerTable
            // transform lift this body verbatim.
            regs[caller ? regs[caller + SLOTS.REG_BASE] + (retDst >> 1) : 0] = retVal;
            break;
          }
        case 127:
          {
            // BXOR_87_17_8 (specialized)
            var dst = 87;
            var a = regs[base + 17];
            regs[base + dst] = a ^ regs[base + 8];
            break;
          }
        case 128:
          {
            // LT_80_22_80 (specialized)
            var dst = 80;
            var a = regs[base + 22];
            regs[base + dst] = a < regs[base + 80];
            break;
          }
        case 129:
          {
            // LT_87_7_3 (specialized)
            var dst = 87;
            var a = regs[base + 7];
            regs[base + dst] = a < regs[base + 3];
            break;
          }
        case 130:
          {
            // USHR_87_1_11 (specialized)
            var dst = 87;
            var a = regs[base + 1];
            regs[base + dst] = a >>> regs[base + 11];
            break;
          }
        case 131:
          {
            // BXOR_12_1_87 (specialized)
            var dst = 12;
            var a = regs[base + 1];
            regs[base + dst] = a ^ regs[base + 87];
            break;
          }
        case 132:
          {
            // BOR_87_9_10 (specialized)
            var dst = 87;
            var a = regs[base + 9];
            regs[base + dst] = a | regs[base + 10];
            break;
          }
        case 133:
          {
            // LOAD_GLOBAL_14_33_2508669417 (specialized)
            var dst = 14;
            var globalName = this._constant(33, 2508669417);
            if (!(globalName in this.globals)) {
              throw new ReferenceError(`${globalName} is not defined`);
            }
            regs[base + dst] = this.globals[globalName];
            break;
          }
        case 134:
          {
            // JUMP_REG_81 (specialized)
            // Indirect jump: allows VM to jump based on runtime values.
            regs[fp + SLOTS.PC] = regs[base + 81];
            break;
          }
        case 135:
          {
            // SHL_7_2_6 (specialized)
            var dst = 7;
            var a = regs[base + 2];
            regs[base + dst] = a << regs[base + 6];
            break;
          }
        case 136:
          {
            // BOR_6_1_7 (specialized)
            var dst = 6;
            var a = regs[base + 1];
            regs[base + dst] = a | regs[base + 7];
            break;
          }
        case 137:
          {
            // USHR_8_6_7 (specialized)
            var dst = 8;
            var a = regs[base + 6];
            regs[base + dst] = a >>> regs[base + 7];
            break;
          }
        case 138:
          {
            // USHR_7_9_6 (specialized)
            var dst = 7;
            var a = regs[base + 9];
            regs[base + dst] = a >>> regs[base + 6];
            break;
          }
        case 139:
          {
            // USHR_8_7_6 (specialized)
            var dst = 8;
            var a = regs[base + 7];
            regs[base + dst] = a >>> regs[base + 6];
            break;
          }
        case 140:
          {
            // BXOR_6_0_7 (specialized)
            var dst = 6;
            var a = regs[base + 0];
            regs[base + dst] = a ^ regs[base + 7];
            break;
          }
        case 141:
          {
            // SHL_7_0_6 (specialized)
            var dst = 7;
            var a = regs[base + 0];
            regs[base + dst] = a << regs[base + 6];
            break;
          }
        case 142:
          {
            // BOR_6_7_8 (specialized)
            var dst = 6;
            var a = regs[base + 7];
            regs[base + dst] = a | regs[base + 8];
            break;
          }
        case 143:
          {
            // SHL_7_2_6 (specialized)
            var dst = 7;
            var a = regs[base + 2];
            regs[base + dst] = a << regs[base + 6];
            break;
          }
        case 144:
          {
            // BXOR_6_0_7 (specialized)
            var dst = 6;
            var a = regs[base + 0];
            regs[base + dst] = a ^ regs[base + 7];
            break;
          }
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