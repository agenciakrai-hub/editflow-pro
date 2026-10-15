# Selección de modelos por defecto

El botón comprueba el catálogo y prueba la visión con una imagen sintética de cuatro colores. Exige posiciones correctas y un JSON completo, incluso si lo acompaña una introducción. No usa fotografías de proyectos. Es una prueba de capacidad y transporte, no un benchmark fotográfico ni garantía de disponibilidad futura.

Guarda hasta tres modelos por proveedor para selección, ajustes, álbum y planificación de vídeo. Prioriza API, capacidades confirmadas y modelos estables. KRAI Web queda para uso manual. La edición JPG solo marca los motores compatibles con el transporte KRAI implementado, priorizando Gemini Image. No genera vídeos ni crea proveedores o claves.

Pruebas seriales:25s,512tokens, hasta nueve candidatos por proveedor para obtener tres válidos. Reutiliza éxitos durante una hora. HTTP401/402/403/429 detiene la cuenta;404/410 excluye el modelo. Un fallo transitorio conserva las capacidades previamente declaradas, pero invalida su comprobación de funcionamiento.

La política verified-three-v1 limita la recuperación API a tres modelos marcados,30s por intento y85s en total por llamada. No auto descubre otros cientos de modelos ni repite cada intento. Si no se puede leer la configuración, no se envían imágenes. Las sesiones KRAI conservan un solo intento.

Comprueba trabajos con actividad reciente antes de guardar, sin cancelar ni eliminar registros antiguos. Si falla una escritura, intenta recuperar las listas anteriores. Si no existe ninguna API comprobada, conserva la configuración previa y explica el motivo.

Pruebas: provider-defaults-review.mjs, provider-defaults-action-review.mjs y provider-defaults-runtime-review.mjs.
