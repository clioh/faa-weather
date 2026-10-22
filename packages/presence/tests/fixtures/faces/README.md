# Face photos for the real-model identity test

`tests/test_identity_real_model.py` runs the real face_recognition (dlib)
model on photos in this folder. It is skipped unless face_recognition is
installed and there are photos here.

Layout: one folder per person, any number of `.jpg` / `.jpeg` / `.png` files.

```
faces/
  clio/   01.jpg 02.jpg 03.jpg
  sam/    01.jpg 02.jpg
```

You need at least two people, and at least one of them needs two or more
photos (one is held out as the probe). Use one clearly visible face per
photo, ideally taken in front of the mirror camera. Point
`SKYGLASS_FACE_FIXTURES` at another folder to keep the photos out of the repo.
