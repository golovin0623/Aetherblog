package service

func textLayerCharCount(text string) int {
	total := 0
	for _, r := range text {
		if r > 0xFFFF {
			total += 2
			continue
		}
		total++
	}
	return total
}
