function set_alumno_materia(
  curs_mate,
  curs_mate_prof,
  alum_curs_mate,
  alum_curs,
  cod_mate,
  des_mate
) {
  var data = new FormData();
  data.append("opc", "set_alum_mate");
  data.append("curs_mate", curs_mate);
  data.append("curs_mate_prof", curs_mate_prof);
  data.append("alum_curs_mate", alum_curs_mate);
  data.append("alum_curs", alum_curs);
  data.append("cod_mate", cod_mate);
  data.append("desc_mate", des_mate);
  var xhr = new XMLHttpRequest();
  xhr.open("POST", "../../../../alumnos/script_set_alum.php", true);
  xhr.onreadystatechange = function () {
    if (xhr.readyState == 4 && xhr.status == 200) {
      window.location = "/alumnos/aulavirtual/";
    }
  };
  xhr.send(data);
}
