# Gravner-Griffeath Snowflakes

For the [London Computation Club](http://london.computation.club)'s 2017
[Festive Show and Tell](https://github.com/computationclub/computationclub.github.io/wiki/Festive-Show-and-Tell-2017)
I implemented the celullar automata snowflake simulation presented in:

> [Modeling Snow Crystal Growth II: A mesoscopic lattice map with plausible dynamics.](http://psoup.math.wisc.edu/papers/h2l.pdf)
>
> Janko Gravner & David Griffeath (2007) - [doi:10.1016/j.physd.2007.09.008](http://dx.doi.org/10.1016/j.physd.2007.09.008).

My first implemention was a proof of concept using Python + Jupyter + numpy.

Once I was confident that I understood the algorithm I reimplemented it using
Javascript + webGL both as an excuse to learn webGL and a way of improving
performance by doing as much of the simulation as possible on the GPU.
