// La marca para procesar no valida una fotografía ni modifica su curación.
export function curatedStatus(photo) {
  if (photo.aiReview || photo.rating === 3) return 'REVIEW';
  const status = photo.status || 'REVIEW';
  // Recupera marcas antiguas promovidas por Guardar sin estrellas ni análisis.
  if ((status === 'SELECT' || status === 'TOP_PICK') && !(photo.rating > 0)) return 'REVIEW';
  return status;
}
export function curatedLabel(photo) {
  const status = curatedStatus(photo);
  return status === 'SELECT' || status === 'TOP_PICK' ? 'green' : status === 'REJECT' ? 'red' : photo.rating === 3 || photo.aiReview ? 'yellow' : 'none';
}
